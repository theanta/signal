#!/usr/bin/env bash
# Deploy one stack (beta or staging) on the Oracle server: pull, rebuild the
# backend, reload it under pm2, and rebuild the engine container when
# signal-engine/ changed. Each stack is its own checkout with its own .env
# files; run this from inside the checkout.
#
#   ./deploy/deploy.sh beta             pull and deploy ~/signal-beta
#   ./deploy/deploy.sh staging --engine also rebuild/restart the engine (use
#                                       after editing signal-engine/.env)
#   ./deploy/deploy.sh staging --no-pull  deploy what is checked out
#
# Ports come from the checkout's .env: BACKEND_PORT for the backend, the port
# in SIGNAL_ENGINE_URL for the engine. Beta uses 3001/8001, staging 3002/8002.
set -euo pipefail

STACK="${1:-}"
case "$STACK" in
  beta|staging) shift ;;
  *) echo "usage: $0 <beta|staging> [--engine] [--no-pull]" >&2; exit 1 ;;
esac

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

FORCE_ENGINE=0
PULL=1
for arg in "$@"; do
  case "$arg" in
    --engine)  FORCE_ENGINE=1 ;;
    --no-pull) PULL=0 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

ENGINE_IMAGE="signal-engine:$STACK"
ENGINE_CONTAINER="signal-$STACK-engine"
STATE_DIR="$REPO_DIR/.deploy"
mkdir -p "$STATE_DIR"

# .env cannot be shell-sourced (an unquoted paren), so read single values.
env_value() {
  grep -E "^$2=" "$1" | tail -n 1 | cut -d= -f2-
}

wait_for() {
  local name="$1" url="$2"
  for _ in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "    $name is up"
      return 0
    fi
    sleep 2
  done
  echo "    $name did not answer $url within 120s" >&2
  return 1
}

echo "==> Checking env files ($STACK)"
for f in .env signal-engine/.env; do
  [[ -f "$f" ]] || { echo "missing $REPO_DIR/$f" >&2; exit 1; }
done
backend_key="$(env_value .env ENGINE_API_KEY)"
engine_key="$(env_value signal-engine/.env ENGINE_API_KEY)"
if [[ -z "$backend_key" || "$backend_key" != "$engine_key" ]]; then
  echo "ENGINE_API_KEY must be set and identical in .env and signal-engine/.env" >&2
  exit 1
fi
backend_port="$(env_value .env BACKEND_PORT)"
engine_url="$(env_value .env SIGNAL_ENGINE_URL)"
if [[ ! "$backend_port" =~ ^[0-9]+$ ]]; then
  echo "BACKEND_PORT must be set in .env (beta 3001, staging 3002)" >&2
  exit 1
fi
if [[ ! "$engine_url" =~ ^http://127\.0\.0\.1:([0-9]+)$ ]]; then
  echo "SIGNAL_ENGINE_URL must be http://127.0.0.1:<port> (beta 8001, staging 8002), got '$engine_url'" >&2
  exit 1
fi
engine_port="${BASH_REMATCH[1]}"
# Scheduled scrapes spend Apify credits and the two stacks use different
# databases, so only beta may run them.
cron_enabled="$(env_value .env CRON_ENABLED)"
if [[ "$STACK" == staging && "$cron_enabled" != false ]]; then
  echo "staging must set CRON_ENABLED=false in .env" >&2
  exit 1
fi
echo "    backend :$backend_port, engine :$engine_port, CRON_ENABLED=${cron_enabled:-true}"

if [[ "$PULL" == 1 ]]; then
  echo "==> Pulling"
  git pull --ff-only
fi

echo "==> Engine"
# The tree hash of signal-engine/ changes only when its tracked contents do.
engine_rev="$(git rev-parse HEAD:signal-engine)"
last_rev="$(cat "$STATE_DIR/engine-rev" 2>/dev/null || true)"
running="$(docker ps -q -f name="^${ENGINE_CONTAINER}$")"
if [[ "$FORCE_ENGINE" == 1 || "$engine_rev" != "$last_rev" || -z "$running" ]]; then
  docker build -t "$ENGINE_IMAGE" signal-engine
  docker rm -f "$ENGINE_CONTAINER" >/dev/null 2>&1 || true
  # Published on loopback only: the backend is the engine's one client.
  # Inside the container it always listens on 8001. Chromium needs more
  # shared memory than Docker's 64 MB default, and the memory cap keeps one
  # stack's runaway scrape from starving the other.
  docker run -d --name "$ENGINE_CONTAINER" \
    --restart unless-stopped \
    --env-file signal-engine/.env \
    -e PORT=8001 \
    -p "127.0.0.1:$engine_port:8001" \
    --shm-size=1g \
    --memory=3g \
    --log-opt max-size=10m --log-opt max-file=3 \
    "$ENGINE_IMAGE" >/dev/null
  echo "$engine_rev" > "$STATE_DIR/engine-rev"
  docker image prune -f >/dev/null
else
  echo "    signal-engine/ unchanged, container left running"
fi
wait_for engine "http://127.0.0.1:$engine_port/health"

echo "==> Backend"
npm ci
npm run build:backend
SIGNAL_STACK="$STACK" pm2 startOrReload deploy/ecosystem.config.js --update-env
pm2 save >/dev/null
wait_for backend "http://127.0.0.1:$backend_port/health"

echo "==> Deployed $STACK: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

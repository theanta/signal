#!/usr/bin/env bash
# One-time setup of a fresh Oracle Always Free Ubuntu 24.04 server for Intentlark.
# Installs Node 22, pm2, Docker and Caddy, opens ports 80/443 in the host
# firewall and points Caddy at the beta and staging backends. Safe to re-run.
#
#   ./deploy/setup-server.sh api.intentlark.theanta.com api.staging.intentlark.theanta.com
#
# Run as the default `ubuntu` user from inside either checkout. See
# docs/runbooks/oracle-deploy.md for the Oracle Console steps that come first.
set -euo pipefail

BETA_API_DOMAIN="${1:-}"
STAGING_API_DOMAIN="${2:-}"
if [[ -z "$BETA_API_DOMAIN" || -z "$STAGING_API_DOMAIN" ]]; then
  echo "usage: $0 <beta-api-domain> <staging-api-domain>" >&2
  echo "   e.g. $0 api.intentlark.theanta.com api.staging.intentlark.theanta.com" >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> System packages"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  git curl ca-certificates gnupg debian-keyring debian-archive-keyring \
  apt-transport-https iptables-persistent

# Oracle's Ubuntu images ship iptables rules that REJECT everything but SSH,
# on top of the VCN security list. Both have to allow 80/443.
echo "==> Host firewall: allow 80 and 443"
for port in 80 443; do
  if ! sudo iptables -C INPUT -m state --state NEW -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport "$port" -j ACCEPT
  fi
done
sudo netfilter-persistent save

echo "==> Node 22"
if ! command -v node >/dev/null || [[ "$(node -v)" != v22.* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> pm2"
if ! command -v pm2 >/dev/null; then
  sudo npm install -g pm2
fi
pm2 install pm2-logrotate >/dev/null
# Start pm2 (and the backend it has saved) on boot.
sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null

echo "==> Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER"

echo "==> Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y caddy
fi
sed -e "s/__BETA_API_DOMAIN__/$BETA_API_DOMAIN/" -e "s/__STAGING_API_DOMAIN__/$STAGING_API_DOMAIN/" \
  "$REPO_DIR/deploy/Caddyfile" | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo systemctl reload caddy

cat <<EOF

Server is ready. Next:
  1. Log out and back in, so the docker group applies to your shell.
  2. Put .env and signal-engine/.env in ~/signal-beta and ~/signal-staging
     (see the runbook).
  3. In each checkout: ./deploy/deploy.sh beta --engine
                       ./deploy/deploy.sh staging --engine
Caddy fetches certificates for $BETA_API_DOMAIN and $STAGING_API_DOMAIN
once their DNS A records point here.
EOF

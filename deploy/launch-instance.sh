#!/usr/bin/env bash
# Creates the Always Free Oracle server, retrying until Oracle has capacity.
# Ampere A1 capacity in a single-AD region (Mumbai) comes and goes; the
# console gives up after one try, this keeps asking every few minutes and
# stops the moment one server exists. Run on your laptop, not the server:
#
#   caffeinate -i ./deploy/launch-instance.sh
#
# Needs the OCI CLI (`brew install oci-cli`) with ~/.oci/config set up, see
# docs/runbooks/oracle-deploy.md. Always Free limits are enforced here: the
# shape is fixed at 1 OCPU / 6 GB unless OCPUS/MEMORY_GB say otherwise, and
# it refuses anything above 2 OCPU / 12 GB.
set -euo pipefail

NAME="${NAME:-intentlark}"
OCPUS="${OCPUS:-1}"
MEMORY_GB="${MEMORY_GB:-6}"
BOOT_GB="${BOOT_GB:-100}"
SUBNET_NAME="${SUBNET_NAME:-intentlark-subnet}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519.pub}"
WAIT_SECONDS="${WAIT_SECONDS:-120}"
SHAPE=VM.Standard.A1.Flex

if (( OCPUS > 2 || MEMORY_GB > 12 )); then
  echo "OCPUS=$OCPUS MEMORY_GB=$MEMORY_GB is over the Always Free limit (2 OCPU / 12 GB)" >&2
  exit 1
fi
command -v oci >/dev/null || { echo "OCI CLI not found: brew install oci-cli" >&2; exit 1; }
[[ -f "$SSH_KEY" ]] || { echo "SSH public key not found: $SSH_KEY" >&2; exit 1; }
[[ -f "$HOME/.oci/config" ]] || { echo "~/.oci/config missing; see the runbook" >&2; exit 1; }

# The root compartment is the tenancy itself.
TENANCY="$(awk -F= '/^tenancy[[:space:]]*=/{gsub(/[[:space:]]/,"",$2); print $2; exit}' "$HOME/.oci/config")"
[[ -n "$TENANCY" ]] || { echo "no tenancy= line in ~/.oci/config" >&2; exit 1; }

echo "==> Looking up the availability domain, subnet and image"
AD="$(oci iam availability-domain list --compartment-id "$TENANCY" --query 'data[0].name' --raw-output)"
SUBNET="$(oci network subnet list --compartment-id "$TENANCY" --display-name "$SUBNET_NAME" \
  --lifecycle-state AVAILABLE --query 'data[0].id' --raw-output 2>/dev/null || true)"
if [[ -z "$SUBNET" || "$SUBNET" == "null" ]]; then
  cat >&2 <<EOF
No subnet named '$SUBNET_NAME'. Create the network once in the console:
  Networking → Virtual cloud networks → Start VCN Wizard →
  "Create VCN with Internet Connectivity", VCN name intentlark-vcn,
  then rename its public subnet to $SUBNET_NAME (or pass SUBNET_NAME=...).
EOF
  exit 1
fi
IMAGE="$(oci compute image list --compartment-id "$TENANCY" \
  --operating-system "Canonical Ubuntu" --operating-system-version "24.04" \
  --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC \
  --query 'data[0].id' --raw-output)"
echo "    AD $AD"
echo "    subnet $SUBNET"
echo "    image $IMAGE (Ubuntu 24.04, ARM)"

existing() {
  oci compute instance list --compartment-id "$TENANCY" --display-name "$NAME" \
    --query "data[?\"lifecycle-state\"!='TERMINATED' && \"lifecycle-state\"!='TERMINATING'].id | [0]" \
    --raw-output 2>/dev/null || true
}

attempt=0
while true; do
  id="$(existing)"
  if [[ -n "$id" && "$id" != "null" ]]; then
    echo "==> Server '$NAME' exists: $id"
    break
  fi

  attempt=$((attempt + 1))
  # Rotate through the three fault domains; one sometimes has room when
  # the others do not.
  fd="FAULT-DOMAIN-$(( (attempt - 1) % 3 + 1 ))"
  echo "==> Attempt $attempt ($fd, $OCPUS OCPU / $MEMORY_GB GB) at $(date '+%H:%M:%S')"

  # stdout is the new instance id; errors go to a file so a CLI warning can
  # never end up inside the id.
  err_file="$(mktemp)"
  if id="$(oci compute instance launch \
      --availability-domain "$AD" \
      --fault-domain "$fd" \
      --compartment-id "$TENANCY" \
      --display-name "$NAME" \
      --shape "$SHAPE" \
      --shape-config "{\"ocpus\": $OCPUS, \"memoryInGBs\": $MEMORY_GB}" \
      --image-id "$IMAGE" \
      --boot-volume-size-in-gbs "$BOOT_GB" \
      --subnet-id "$SUBNET" \
      --assign-public-ip true \
      --ssh-authorized-keys-file "$SSH_KEY" \
      --query 'data.id' --raw-output 2>"$err_file")"; then
    rm -f "$err_file"
    echo "==> Launched: $id"
    break
  fi
  out="$(cat "$err_file")"
  rm -f "$err_file"

  case "$out" in
    *"Out of host capacity"*|*"Out of capacity"*|*InternalError*)
      echo "    no capacity yet; retrying in ${WAIT_SECONDS}s" ;;
    *TooManyRequests*)
      echo "    rate limited; retrying in $((WAIT_SECONDS * 2))s"
      sleep "$WAIT_SECONDS" ;;
    *)
      echo "$out" >&2
      echo "Stopped: that is not a capacity error, so retrying will not help." >&2
      exit 1 ;;
  esac
  sleep "$WAIT_SECONDS"
done

echo "==> Waiting for it to start"
oci compute instance get --instance-id "$id" --wait-for-state RUNNING \
  --max-wait-seconds 600 >/dev/null
ip="$(oci compute instance list-vnics --instance-id "$id" \
  --query 'data[0]."public-ip"' --raw-output)"
echo "==> Running. Public IP: $ip"
echo "    ssh ubuntu@$ip"
command -v osascript >/dev/null && \
  osascript -e "display notification \"Public IP $ip\" with title \"Oracle server is running\"" || true

#!/usr/bin/env bash
# Read-only disk and Docker space inventory for a Flux host.
#
# Run on the server:
#   ./bin/ops-disk-inventory.sh
#
# Run from your laptop (SSH defaults match bin/sync-env-remote.sh):
#   ./bin/ops-disk-inventory.sh --remote
#
set -euo pipefail

FLUX_SYNC_SSH_USER="${FLUX_SYNC_SSH_USER:-root}"
FLUX_SYNC_SSH_HOST="${FLUX_SYNC_SSH_HOST:-178.104.205.138}"
FLUX_SYNC_REMOTE="${FLUX_SYNC_REMOTE:-${FLUX_SYNC_SSH_USER}@${FLUX_SYNC_SSH_HOST}}"
FLUX_REMOTE_REPO_ROOT="${FLUX_REMOTE_REPO_ROOT:-/srv/platform/flux}"
FLUX_WEB_CONTAINER="${FLUX_WEB_CONTAINER:-flux-web}"

run_inventory() {
  echo "Flux disk inventory — $(date -u +%Y-%m-%dT%H:%M:%SZ) — host $(hostname -f 2>/dev/null || hostname)"
  echo ""

  echo "=== Root filesystem ==="
  df -h / /var/lib/docker 2>/dev/null || df -h /
  echo ""

  echo "=== /srv breakdown ==="
  if [[ -d /srv ]]; then
    du -h -d 1 /srv 2>/dev/null | sort -h | sed 's/^/  /'
  else
    echo "  (no /srv directory)"
  fi
  echo ""

  echo "=== /var/lib/docker breakdown ==="
  if [[ -d /var/lib/docker ]]; then
    du -h -d 1 /var/lib/docker 2>/dev/null | sort -h | sed 's/^/  /'
  else
    echo "  (no /var/lib/docker directory)"
  fi
  echo ""

  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    echo "=== docker system df ==="
    docker system df
    echo ""

    echo "=== exited flux-* containers ==="
    local exited
    exited="$(docker ps -a --filter status=exited --format '{{.Names}}\t{{.Status}}\t{{.Size}}' | grep -E '^flux-' || true)"
    if [[ -z "$exited" ]]; then
      echo "  none"
    else
      echo "$exited" | sed 's/^/  /'
    fi
    echo ""

    echo "=== unused volumes (LINKS=0, top 15 by reported size) ==="
    docker system df -v 2>/dev/null | awk '
      /^VOLUME NAME/ { v=1; next }
      v && /^Local/ { v=0 }
      v && $2 == 0 { print $3, $1 }
    ' | sort -hr | head -15 | sed 's/^/  /' || echo "  (could not list volumes)"
    echo ""

    echo "=== large container logs (top 10) ==="
    find /var/lib/docker/containers -name '*-json.log' -exec du -h {} + 2>/dev/null \
      | sort -hr | head -10 | sed 's/^/  /' || echo "  (none or permission denied)"
    echo ""

    if docker inspect "$FLUX_WEB_CONTAINER" >/dev/null 2>&1; then
      echo "=== backup dirs in $FLUX_WEB_CONTAINER ==="
      docker exec "$FLUX_WEB_CONTAINER" sh -c '
        for d in /srv/flux/backups /srv/flux/backups-offsite; do
          if [ -d "$d" ]; then
            echo "  $d: $(du -sh "$d" 2>/dev/null | cut -f1) projects=$(find "$d" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l) dumps=$(find "$d" -name "*.dump" -type f 2>/dev/null | wc -l)"
          fi
        done
      ' 2>/dev/null || echo "  (could not inspect backup dirs)"
    fi
  else
    echo "=== docker ==="
    echo "  docker not available on this host"
  fi
}

usage() {
  sed -n '3,9p' "$0" | sed 's/^# \{0,1\}//'
}

main() {
  local remote=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help|help)
        usage
        exit 0
        ;;
      --remote)
        remote=1
        shift
        ;;
      *)
        echo "Unknown option: $1" >&2
        usage
        exit 2
        ;;
    esac
  done

  if [[ "$remote" == "1" ]]; then
    echo "Remote inventory via SSH: $FLUX_SYNC_REMOTE"
    ssh -o BatchMode=yes -o ConnectTimeout=15 "$FLUX_SYNC_REMOTE" \
      "FLUX_REMOTE_REPO_ROOT='$FLUX_REMOTE_REPO_ROOT' FLUX_WEB_CONTAINER='$FLUX_WEB_CONTAINER' bash -s" <"$0"
    exit $?
  fi

  run_inventory
}

main "$@"

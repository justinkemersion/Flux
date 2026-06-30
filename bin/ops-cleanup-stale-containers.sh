#!/usr/bin/env bash
# Remove exited flux-* Docker containers (test/orphan stacks).
#
# Default is dry-run (list only). Pass --apply to remove after review.
#
#   ./bin/ops-cleanup-stale-containers.sh
#   ./bin/ops-cleanup-stale-containers.sh --apply
#   ./bin/ops-cleanup-stale-containers.sh --remote
#   ./bin/ops-cleanup-stale-containers.sh --remote --apply
#
# Does not prune volumes or images. Review output before --apply.
#
set -euo pipefail

FLUX_SYNC_SSH_USER="${FLUX_SYNC_SSH_USER:-root}"
FLUX_SYNC_SSH_HOST="${FLUX_SYNC_SSH_HOST:-178.104.205.138}"
FLUX_SYNC_REMOTE="${FLUX_SYNC_REMOTE:-${FLUX_SYNC_SSH_USER}@${FLUX_SYNC_SSH_HOST}}"
FLUX_REMOTE_REPO_ROOT="${FLUX_REMOTE_REPO_ROOT:-/srv/platform/flux}"

APPLY=0

list_stale() {
  docker ps -a --filter status=exited --format '{{.Names}}\t{{.Status}}\t{{.ID}}' \
    | grep -E '^flux-' || true
}

run_cleanup() {
  if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
    echo "ERROR: docker not available on this host" >&2
    exit 1
  fi

  local stale
  stale="$(list_stale)"
  if [[ -z "$stale" ]]; then
    echo "No exited flux-* containers."
    exit 0
  fi

  echo "Exited flux-* containers:"
  echo "$stale" | sed 's/^/  /'
  echo ""

  if [[ "$APPLY" != "1" ]]; then
    echo "Dry-run — pass --apply to remove these containers (volumes are not pruned)."
    exit 0
  fi

  local name removed=0
  while IFS=$'\t' read -r name _status _id; do
    [[ -z "$name" ]] && continue
    echo "Removing $name ..."
    docker rm "$name"
    removed=$((removed + 1))
  done <<<"$stale"

  echo ""
  echo "Removed $removed container(s). Run ./bin/ops-disk-inventory.sh to recheck disk."
}

usage() {
  sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'
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
      --apply)
        APPLY=1
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
    echo "Remote cleanup via SSH: $FLUX_SYNC_REMOTE (apply=${APPLY})"
    ssh -o BatchMode=yes -o ConnectTimeout=15 "$FLUX_SYNC_REMOTE" \
      "FLUX_REMOTE_REPO_ROOT='$FLUX_REMOTE_REPO_ROOT' bash -s -- ${APPLY:+--apply}" <"$0"
    exit $?
  fi

  run_cleanup
}

main "$@"

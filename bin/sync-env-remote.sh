#!/usr/bin/env bash
# Sync selected gitignored env files from this machine to a remote host over SSH.
#
# Why: .env files are not in git; production/staging secrets live on the server.
#      This script pushes only an explicit whitelist (never the whole tree).
#
# Usage:
#   ./bin/sync-env-remote.sh              # dry-run using defaults below
#   ./bin/sync-env-remote.sh --apply      # write using defaults
#   ./bin/sync-env-remote.sh user@host    # dry-run, override ssh target
#   ./bin/sync-env-remote.sh user@host --apply
#
# Defaults are editable in this file (or override with env when invoking):
#   FLUX_SYNC_SSH_USER, FLUX_SYNC_SSH_HOST — built into user@host
#   FLUX_SYNC_REMOTE — if set, overrides user@host entirely
#   FLUX_REMOTE_REPO_ROOT — path on remote (default ~/Projects/flux)
#
# Default is dry-run (rsync -n). Pass --apply to write files on the remote.
#
# Prerequisites:
#   - SSH key auth to the remote
#   - Same repo path on remote as FLUX_REMOTE_REPO_ROOT
#
# After sync on the server, recreate containers that read those files, e.g.:
#   docker compose -f docker/web/docker-compose.yml up -d --force-recreate
#   docker compose -f packages/gateway/docker-compose.yml up -d --force-recreate
#   (and v2-shared if you changed docker/v2-shared/.env)
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults — edit once; or override per run: FLUX_SYNC_SSH_HOST=other ./bin/...
# ---------------------------------------------------------------------------
FLUX_SYNC_SSH_USER="${FLUX_SYNC_SSH_USER:-justin}"
FLUX_SYNC_SSH_HOST="${FLUX_SYNC_SSH_HOST:-178.104.205.138}"
# Full ssh target (user@host). Set explicitly to override the two vars above.
FLUX_SYNC_REMOTE="${FLUX_SYNC_REMOTE:-${FLUX_SYNC_SSH_USER}@${FLUX_SYNC_SSH_HOST}}"
FLUX_REMOTE_REPO_ROOT="${FLUX_REMOTE_REPO_ROOT:-~/Projects/flux}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

show_help() {
  sed -n '3,28p' "$0" | sed 's/^# *//'
}

APPLY=0
REMOTE_OVERRIDE=""
for a in "$@"; do
  case "$a" in
    -h | --help)
      show_help
      exit 0
      ;;
    --apply)
      APPLY=1
      ;;
    *)
      if [[ -n "${REMOTE_OVERRIDE}" ]]; then
        echo "Unexpected extra argument: $a (expected at most one user@host)" >&2
        exit 1
      fi
      REMOTE_OVERRIDE="$a"
      ;;
  esac
done

REMOTE="${REMOTE_OVERRIDE:-$FLUX_SYNC_REMOTE}"
if [[ "$REMOTE" != *"@"* ]]; then
  echo "Invalid ssh target (expected user@host): '$REMOTE'" >&2
  echo "Edit FLUX_SYNC_SSH_USER / FLUX_SYNC_SSH_HOST in $0, or set FLUX_SYNC_REMOTE." >&2
  exit 1
fi

REMOTE_ROOT="${FLUX_REMOTE_REPO_ROOT}"
REMOTE_ROOT="${REMOTE_ROOT%/}"

# Paths relative to repo root (edit here if you add new env surfaces).
FILES=(
  "docker/web/.env"
  "packages/gateway/.env"
  "docker/v2-shared/.env"
)

RSYNC_OPTS=(-avz --relative)
if [[ "$APPLY" -eq 0 ]]; then
  RSYNC_OPTS+=(-n)
  echo "=== DRY RUN (no files written on remote). Pass --apply to sync. ==="
  echo "  remote: $REMOTE"
  echo "  dest:   $REMOTE_ROOT/"
else
  echo "=== APPLY: writing files on $REMOTE:$REMOTE_ROOT/ ==="
fi

for f in "${FILES[@]}"; do
  if [[ ! -f "$REPO_ROOT/$f" ]]; then
    echo "WARN: local file missing, skipping: $f" >&2
  fi
done

# rsync --relative sends ./docker/web/.env preserving path segments from .
# so remote receives .../Projects/flux/docker/web/.env when REMOTE_ROOT is ~/Projects/flux
args=()
for f in "${FILES[@]}"; do
  [[ -f "$REPO_ROOT/$f" ]] || continue
  args+=("./$f")
done

if [[ "${#args[@]}" -eq 0 ]]; then
  echo "Nothing to sync (all whitelisted files missing locally)." >&2
  exit 1
fi

rsync "${RSYNC_OPTS[@]}" "${args[@]}" "${REMOTE}:${REMOTE_ROOT}/"

if [[ "$APPLY" -eq 0 ]]; then
  echo ""
  echo "Dry run complete. Re-run with --apply after reviewing the list above."
fi

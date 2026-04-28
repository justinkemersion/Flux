#!/usr/bin/env bash
# Sync selected gitignored env files from this machine to a remote host over SSH.
#
# Why: .env files are not in git; production/staging secrets live on the server.
#      This script pushes only an explicit whitelist (never the whole tree).
#
# Usage:
#   ./bin/sync-env-remote.sh user@host [--apply]
#
# Default is dry-run (rsync -n). Pass --apply to write files on the remote.
#
# Environment:
#   FLUX_REMOTE_REPO_ROOT  — path on remote (default: ~/Projects/flux; ~ expands on remote)
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [[ "${1:-}" == "" || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  sed -n '1,35p' "$0" | tail -n +2
  exit 0
fi

REMOTE="${1:?remote host required, e.g. user@my.server (see --help)}"
shift
APPLY=0
for a in "$@"; do
  if [[ "$a" == "--apply" ]]; then
    APPLY=1
  fi
done

REMOTE_ROOT="${FLUX_REMOTE_REPO_ROOT:-~/Projects/flux}"
# Strip trailing slash for rsync
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
else
  echo "=== APPLY: writing files on $REMOTE:$REMOTE_ROOT ==="
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

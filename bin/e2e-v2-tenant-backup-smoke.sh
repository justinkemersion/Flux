#!/usr/bin/env bash
# Optional smoke: v2_shared portable tenant backup via control-plane CLI API.
#
# Prerequisites:
#   - flux-web (dashboard) reachable at FLUX_API_BASE with backups routes enabled.
#   - FLUX_SHARED_POSTGRES_URL set on the server (same as engine-v2 / migrate).
#   - postgresql-client `pg_dump` on PATH inside flux-web (same as v2 migrate).
#   - A v2_shared project owned by the token user.
#
# Usage:
#   export FLUX_API_BASE=https://your-dashboard/api
#   export FLUX_API_TOKEN=...
#   export FLUX_SMOKE_PROJECT_SLUG=myproject
#   export FLUX_SMOKE_PROJECT_HASH=abcdef0123456...
#   ./bin/e2e-v2-tenant-backup-smoke.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FLUX_API_BASE="${FLUX_API_BASE:?set FLUX_API_BASE}"
FLUX_API_TOKEN="${FLUX_API_TOKEN:?set FLUX_API_TOKEN}"
HASH="${FLUX_SMOKE_PROJECT_HASH:?set FLUX_SMOKE_PROJECT_HASH}"
SLUG="${FLUX_SMOKE_PROJECT_SLUG:?set FLUX_SMOKE_PROJECT_SLUG}"

BASE="${FLUX_API_BASE%/}"
export FLUX_API_BASE="$BASE"

echo "v2 tenant backup smoke: FLUX_API_BASE=${BASE} slug=${SLUG} hash=${HASH}"

pnpm exec flux backup create -p "$SLUG" --hash "$HASH" >/dev/null
pnpm exec flux backup list -p "$SLUG" --hash "$HASH" --verbose | head -n 40
pnpm exec flux backup verify -p "$SLUG" --hash "$HASH" --latest

echo "ok: backup create + verify completed"

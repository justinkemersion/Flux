#!/usr/bin/env bash
# Mint HS256 Bearer for ./bin/e2e-v2-shared-smoke.sh (prints token to stdout).
#
# Secret from env:
#   FLUX_SMOKE_JWT_SECRET=... ./bin/mint-smoke-bearer.sh
#
# Or load jwt_secret from flux-system catalog Postgres (typical on server):
#   FLUX_SMOKE_PROJECT_SLUG=habitat FLUX_SMOKE_PROJECT_HASH=59b73eb \
#     FLUX_SYSTEM_DB_CONTAINER=flux-5y57e70-flux-system-db \
#     ./bin/mint-smoke-bearer.sh
#
# Container auto-detect: first running Docker name matching *flux-system-db.
#
# Full smoke (production host):
#   SLUG=habitat HASH=59b73eb DOMAIN=vsl-base.com
#   export FLUX_SMOKE_KNOWN_HOST="api--${SLUG}--${HASH}.${DOMAIN}"
#   export FLUX_SMOKE_BEARER="$(FLUX_SMOKE_PROJECT_SLUG=$SLUG FLUX_SMOKE_PROJECT_HASH=$HASH ./bin/mint-smoke-bearer.sh)"
#   ./bin/e2e-v2-shared-smoke.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

secret="${FLUX_SMOKE_JWT_SECRET:-}"

if [[ -z "$secret" ]]; then
  slug="${FLUX_SMOKE_PROJECT_SLUG:-}"
  hash="${FLUX_SMOKE_PROJECT_HASH:-}"
  if [[ -z "$slug" || -z "$hash" ]]; then
    echo "error: set FLUX_SMOKE_JWT_SECRET or FLUX_SMOKE_PROJECT_SLUG + FLUX_SMOKE_PROJECT_HASH" >&2
    exit 2
  fi

  container="${FLUX_SYSTEM_DB_CONTAINER:-}"
  if [[ -z "$container" ]]; then
    container="$(
      docker ps --format '{{.Names}}' 2>/dev/null \
        | grep -E 'flux-system-db$' \
        | head -n 1 \
        || true
    )"
  fi
  if [[ -z "$container" ]]; then
    echo "error: set FLUX_SYSTEM_DB_CONTAINER or run flux-system-db in Docker" >&2
    exit 2
  fi

  secret="$(
    docker exec "$container" psql -U postgres -d postgres -tAc \
      "SELECT jwt_secret FROM projects WHERE slug='${slug}' AND hash='${hash}' LIMIT 1" \
      | tr -d '[:space:]'
  )"
  if [[ -z "$secret" ]]; then
    echo "error: no jwt_secret for slug=${slug} hash=${hash} in ${container}" >&2
    exit 1
  fi
fi

export FLUX_SMOKE_JWT_SECRET="$secret"
exec node "$ROOT/bin/mint-smoke-bearer.mjs"

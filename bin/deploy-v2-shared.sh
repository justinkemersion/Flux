#!/bin/bash
# Rebuild and restart the Flux v2 shared data-plane stack.
# Run on the host where Docker runs after the repo is present at $REPO_ROOT.
#
#   FLUX_DEPLOY_GIT_SYNC=1        — run `git pull --ff-only` first.
#   FLUX_DEPLOY_PRUNE_BUILDER=1   — also run `docker builder prune -f`.
#   FLUX_V2_COMPOSE_FILE          — compose file override.
#   FLUX_V2_ENV_FILE              — env file to source (default: docker/v2-shared/.env).
#   FLUX_V2_POSTGRES_CONTAINER    — default: flux-postgres-v2
#   FLUX_V2_PGBOUNCER_CONTAINER   — default: flux-pgbouncer
#   FLUX_V2_POSTGREST_CONTAINER   — default: flux-postgrest-pool
#   FLUX_V2_POSTGREST_URL         — default: http://flux-postgrest-pool:3000/
#   FLUX_V2_PROBE_CONTAINER       — default: flux-node-gateway (network probe origin)
#   FLUX_V2_SKIP_POSTGREST_PROBE=1 — skip postgrest HTTP probe
#
# Required env vars for compose interpolation:
#   SHARED_POSTGRES_PASSWORD
#   PGB_BACKEND_PASSWORD
#   PGRST_DB_PASSWORD
#   FLUX_GATEWAY_JWT_SECRET
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE_FILE="${FLUX_V2_COMPOSE_FILE:-docker/v2-shared/docker-compose.yml}"
ENV_FILE="${FLUX_V2_ENV_FILE:-docker/v2-shared/.env}"
COMPOSE="docker compose -f ${COMPOSE_FILE}"
PG_CONTAINER="${FLUX_V2_POSTGRES_CONTAINER:-flux-postgres-v2}"
PGB_CONTAINER="${FLUX_V2_PGBOUNCER_CONTAINER:-flux-pgbouncer}"
PGRST_CONTAINER="${FLUX_V2_POSTGREST_CONTAINER:-flux-postgrest-pool}"
PGRST_URL="${FLUX_V2_POSTGREST_URL:-http://flux-postgrest-pool:3000/}"
PROBE_CONTAINER="${FLUX_V2_PROBE_CONTAINER:-flux-node-gateway}"

echo "--- v2 Shared Deploy: Initializing ---"
echo "  repo: $REPO_ROOT"
echo "  compose: $COMPOSE_FILE"
echo "  env: $ENV_FILE"

if [[ -f "$ENV_FILE" ]]; then
  # Export everything from env file so both this script and docker compose interpolation see it.
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "  WARN: env file not found at ${ENV_FILE}; using current shell environment only."
fi

for req in SHARED_POSTGRES_PASSWORD PGB_BACKEND_PASSWORD PGRST_DB_PASSWORD FLUX_GATEWAY_JWT_SECRET; do
  if [[ -z "${!req:-}" ]]; then
    echo "  ERROR: required environment variable is missing: $req" >&2
    exit 1
  fi
done

if [[ "${FLUX_DEPLOY_GIT_SYNC:-}" == "1" ]]; then
  echo "--- v2 Shared Deploy: Git sync (ff-only) ---"
  if [[ ! -d "$REPO_ROOT/.git" ]]; then
    echo "  skip: not a git checkout"
  else
    git -C "$REPO_ROOT" pull --ff-only
  fi
fi

echo "--- v2 Shared Deploy: Validating compose ---"
$COMPOSE config >/dev/null

echo "--- v2 Shared Deploy: Building images ---"
$COMPOSE build --pull

echo "--- v2 Shared Deploy: Cycling services ---"
$COMPOSE up -d --remove-orphans

echo "--- v2 Shared Deploy: Pruning dangling images ---"
docker image prune -f

if [[ "${FLUX_DEPLOY_PRUNE_BUILDER:-}" == "1" ]]; then
  echo "--- v2 Shared Deploy: Pruning build cache (builder) ---"
  docker builder prune -f
else
  echo "  (Set FLUX_DEPLOY_PRUNE_BUILDER=1 to also prune docker build cache.)"
fi

echo "--- v2 Shared Deploy: Verifying containers ---"
for container in "$PG_CONTAINER" "$PGB_CONTAINER" "$PGRST_CONTAINER"; do
  running="$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || echo false)"
  if [[ "$running" != "true" ]]; then
    status="$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || echo missing)"
    echo "  ERROR: ${container} is not running (State.Running=${running} status=${status})" >&2
    docker ps -a --filter "name=^${container}\$" || true
    exit 1
  fi
  echo "  ${container}: running"
done

if [[ "${FLUX_V2_SKIP_POSTGREST_PROBE:-}" == "1" ]]; then
  echo "--- v2 Shared Deploy: PostgREST probe skipped (FLUX_V2_SKIP_POSTGREST_PROBE=1) ---"
elif docker ps --format '{{.Names}}' | rg -q "^${PROBE_CONTAINER}$"; then
  echo "--- v2 Shared Deploy: PostgREST probe (from ${PROBE_CONTAINER}) ---"
  probe_status="$(
    docker exec "$PROBE_CONTAINER" sh -lc \
      'node -e "fetch(process.argv[1]).then((r)=>{process.stdout.write(String(r.status));}).catch(()=>process.exit(2));" "$1"' \
      _ "$PGRST_URL" 2>/dev/null || true
  )"
  if [[ "$probe_status" == "200" || "$probe_status" == "401" ]]; then
    echo "  postgrest: OK (${PGRST_URL} -> ${probe_status})"
  elif [[ -z "$probe_status" ]]; then
    echo "  WARN: postgrest probe failed from ${PROBE_CONTAINER}; no status returned."
    echo "        (container may lack Node/fetch support; set FLUX_V2_SKIP_POSTGREST_PROBE=1 to skip)"
  else
    echo "  WARN: postgrest probe returned HTTP ${probe_status} at ${PGRST_URL}"
  fi
elif command -v curl >/dev/null 2>&1; then
  echo "--- v2 Shared Deploy: PostgREST probe ---"
  code="$(curl -sS -o /dev/null -w "%{http_code}" "$PGRST_URL" 2>/dev/null || true)"
  if [[ -z "$code" ]]; then
    code="000"
  fi
  if [[ "$code" != "200" && "$code" != "401" ]]; then
    echo "  WARN: postgrest probe returned HTTP ${code} at ${PGRST_URL}"
  else
    echo "  postgrest: OK (${PGRST_URL} -> ${code})"
  fi
else
  echo "  WARN: neither probe container (${PROBE_CONTAINER}) nor host curl probe is available; skipped PostgREST probe."
fi

echo ""
echo "--- v2 Shared Deploy: Operational ---"
echo "  logs postgres:  docker logs -f $PG_CONTAINER"
echo "  logs pgbouncer: docker logs -f $PGB_CONTAINER"
echo "  logs postgrest: docker logs -f $PGRST_CONTAINER"

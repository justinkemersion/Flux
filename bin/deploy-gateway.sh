#!/bin/bash
# Rebuild and restart the Flux Node gateway (@flux/gateway).
# Run on the host where Docker runs after the repo is present at $REPO_ROOT.
#
#   FLUX_DEPLOY_GIT_SYNC=1       — run `git pull --ff-only` first.
#   FLUX_DEPLOY_PRUNE_BUILDER=1  — also run `docker builder prune -f`.
#   FLUX_DEPLOY_RESTART_ONLY=1   — skip image build and prune; `compose up --no-build` only
#                                  (used by bin/restart-gateway.sh).
#   FLUX_GATEWAY_NAME            — gateway container name override (default: flux-node-gateway).
#   FLUX_GATEWAY_HEALTH_URL      — liveness URL (default: http://127.0.0.1:4000/health).
#   FLUX_GATEWAY_DEEP_URL        — readiness URL (default: http://127.0.0.1:4000/health/deep).
#   FLUX_GATEWAY_ROUTE_HOST      — optional host header for edge route probe.
#   FLUX_GATEWAY_SKIP_DB_PREFLIGHT=1 — skip catalog DB connectivity check (not recommended).
#
# Prerequisites:
#   - packages/gateway/.env exists on the host (do not commit it)
#   - external network flux-network exists
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE="docker compose -f packages/gateway/docker-compose.yml"
CONTAINER_NAME="${FLUX_GATEWAY_NAME:-flux-node-gateway}"
HEALTH_URL="${FLUX_GATEWAY_HEALTH_URL:-http://127.0.0.1:4000/health}"
DEEP_URL="${FLUX_GATEWAY_DEEP_URL:-http://127.0.0.1:4000/health/deep}"
ROUTE_HOST="${FLUX_GATEWAY_ROUTE_HOST:-}"
GATEWAY_ENV_FILE="$REPO_ROOT/packages/gateway/.env"
PREFLIGHT_PG_IMAGE="${FLUX_GATEWAY_PREFLIGHT_PG_IMAGE:-postgres:17-alpine}"
PREFLIGHT_NETWORK="${FLUX_GATEWAY_PREFLIGHT_NETWORK:-flux-network}"

GATEWAY_TAG="Deploy"
[[ "${FLUX_DEPLOY_RESTART_ONLY:-}" == "1" ]] && GATEWAY_TAG="Restart"

echo "--- Gateway ${GATEWAY_TAG}: Initializing ---"
echo "  repo: $REPO_ROOT"

if [[ "${FLUX_DEPLOY_GIT_SYNC:-}" == "1" ]]; then
  echo "--- Gateway ${GATEWAY_TAG}: Git sync (ff-only) ---"
  if [[ ! -d "$REPO_ROOT/.git" ]]; then
    echo "  skip: not a git checkout"
  else
    git -C "$REPO_ROOT" pull --ff-only
  fi
fi

# Fail before cycling the container when catalog credentials in .env are stale.
gateway_preflight_system_db() {
  if [[ "${FLUX_GATEWAY_SKIP_DB_PREFLIGHT:-}" == "1" ]]; then
    echo "  skip: FLUX_GATEWAY_SKIP_DB_PREFLIGHT=1"
    return 0
  fi

  if [[ ! -f "$GATEWAY_ENV_FILE" ]]; then
    echo "  ERROR: missing $GATEWAY_ENV_FILE (copy from packages/gateway/.env.example)" >&2
    exit 1
  fi

  local db_url=""
  db_url="$(grep -E '^[[:space:]]*FLUX_SYSTEM_DATABASE_URL=' "$GATEWAY_ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r' || true)"
  db_url="${db_url#\"}"
  db_url="${db_url%\"}"
  db_url="${db_url#\'}"
  db_url="${db_url%\'}"

  if [[ -z "$db_url" ]]; then
    echo "  ERROR: FLUX_SYSTEM_DATABASE_URL is not set in $GATEWAY_ENV_FILE" >&2
    exit 1
  fi

  if ! docker network inspect "$PREFLIGHT_NETWORK" >/dev/null 2>&1; then
    echo "  ERROR: Docker network '$PREFLIGHT_NETWORK' not found (gateway needs flux-system catalog access)" >&2
    exit 1
  fi

  echo "--- Gateway ${GATEWAY_TAG}: Preflight catalog DB ---"
  echo "  file: $GATEWAY_ENV_FILE"
  echo "  network: $PREFLIGHT_NETWORK"

  if docker run --rm --network "$PREFLIGHT_NETWORK" \
    -e "FLUX_SYSTEM_DATABASE_URL=$db_url" \
    "$PREFLIGHT_PG_IMAGE" \
    sh -c 'psql "$FLUX_SYSTEM_DATABASE_URL" -v ON_ERROR_STOP=1 -qAt -c "SELECT 1"' >/dev/null 2>&1; then
    echo "  catalog DB: OK (FLUX_SYSTEM_DATABASE_URL accepts connections)"
    return 0
  fi

  echo "  ERROR: FLUX_SYSTEM_DATABASE_URL in $GATEWAY_ENV_FILE cannot connect to flux-system Postgres." >&2
  echo "         Stale passwords cause tenant resolution failures and fleet mesh 'Error · Unavailable' in the dashboard." >&2
  echo "         Fix: sync secrets (./bin/sync-env-remote.sh --apply) or copy the URL from the running flux-system-db container," >&2
  echo "         then re-run this deploy. To bypass: FLUX_GATEWAY_SKIP_DB_PREFLIGHT=1" >&2
  exit 1
}

gateway_preflight_system_db

if [[ "${FLUX_DEPLOY_RESTART_ONLY:-}" == "1" ]]; then
  echo "--- Gateway ${GATEWAY_TAG}: Cycling container (no image build) ---"
  $COMPOSE up -d --remove-orphans --no-build
else
  echo "--- Gateway ${GATEWAY_TAG}: Building ($CONTAINER_NAME) ---"
  $COMPOSE build --pull

  echo "--- Gateway ${GATEWAY_TAG}: Cycling container ---"
  $COMPOSE up -d --remove-orphans

  echo "--- Gateway ${GATEWAY_TAG}: Pruning dangling images ---"
  docker image prune -f

  if [[ "${FLUX_DEPLOY_PRUNE_BUILDER:-}" == "1" ]]; then
    echo "--- Gateway ${GATEWAY_TAG}: Pruning build cache (builder) ---"
    docker builder prune -f
  else
    echo "  (Set FLUX_DEPLOY_PRUNE_BUILDER=1 to also prune docker build cache.)"
  fi
fi

echo "--- Gateway ${GATEWAY_TAG}: Verifying container ---"
sleep 3
RUNNING="$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || echo false)"
if [[ "$RUNNING" != "true" ]]; then
  STATUS="$(docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo missing)"
  echo "  ERROR: $CONTAINER_NAME is not running (State.Running=$RUNNING status=$STATUS)" >&2
  docker ps -a --filter "name=^${CONTAINER_NAME}\$" || true
  exit 1
fi
echo "  $CONTAINER_NAME: running"
docker ps --filter "name=^${CONTAINER_NAME}\$" --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'

if command -v curl >/dev/null 2>&1; then
  echo "--- Gateway ${GATEWAY_TAG}: Health checks ---"
  HEALTH_CODE="$(curl -sS -o /dev/null -w "%{http_code}" "$HEALTH_URL" || echo "000")"
  if [[ "$HEALTH_CODE" != "200" ]]; then
    echo "  ERROR: liveness check failed (${HEALTH_CODE}) at ${HEALTH_URL}" >&2
    exit 1
  fi
  echo "  liveness: OK (${HEALTH_URL})"

  DEEP_BODY="$(curl -sS "$DEEP_URL" || true)"
  DEEP_CODE="$(curl -sS -o /dev/null -w "%{http_code}" "$DEEP_URL" || echo "000")"
  if [[ "$DEEP_CODE" != "200" ]]; then
    echo "  WARN: readiness check returned ${DEEP_CODE} at ${DEEP_URL}"
    echo "        body: ${DEEP_BODY:-<empty>}"
  else
    echo "  readiness: OK (${DEEP_URL})"
  fi

  if [[ -n "$ROUTE_HOST" ]]; then
    ROUTE_CODE="$(curl -sS -o /dev/null -w "%{http_code}" -H "Host: ${ROUTE_HOST}" "http://127.0.0.1/" || echo "000")"
    if [[ "$ROUTE_CODE" == "200" || "$ROUTE_CODE" == "301" || "$ROUTE_CODE" == "302" || "$ROUTE_CODE" == "307" || "$ROUTE_CODE" == "308" ]]; then
      echo "  route: OK (Host=${ROUTE_HOST} -> ${ROUTE_CODE})"
    else
      echo "  WARN: edge route probe failed for Host=${ROUTE_HOST} (HTTP ${ROUTE_CODE})"
    fi
  fi
else
  echo "  WARN: curl not found; skipped HTTP checks."
fi

echo ""
echo "--- Gateway ${GATEWAY_TAG}: Operational ---"
echo "  logs: docker logs -f $CONTAINER_NAME"

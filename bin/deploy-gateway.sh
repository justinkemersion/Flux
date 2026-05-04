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

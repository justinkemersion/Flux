#!/bin/bash
# Rebuild and restart the Flux control plane (Next.js dashboard + embedded CLI build).
# Run on the host where Docker runs (e.g. Hetzner) after the repo is present at $REPO_ROOT.
#
#   FLUX_DEPLOY_GIT_SYNC=1    —  run `git pull --ff-only` in the repo first (convenience on a server).
#   FLUX_DEPLOY_PRUNE_BUILDER=1 —  also `docker builder prune -f` (frees more NVMe; next build is colder).
#   FLUX_DEPLOY_RESTART_ONLY=1 — skip image build and prune; `compose up --no-build` only
#                                (set by bin/restart-web.sh).
#
# Prerequisite: `docker/web/.env` exists, Traefik + external network `flux-network` (see repo docs).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE="docker compose -f docker/web/docker-compose.yml"
# Must match `container_name` in docker/web/docker-compose.yml
CONTAINER_NAME="flux-web"
GATEWAY_NAME="${FLUX_GATEWAY_CONTAINER_NAME:-flux-gateway}"
CHECK_HOST="${FLUX_DEPLOY_CHECK_HOST:-flux.vsl-base.com}"

FLUX_WEB_TAG="Deploy"
[[ "${FLUX_DEPLOY_RESTART_ONLY:-}" == "1" ]] && FLUX_WEB_TAG="Restart"

echo "--- Flux ${FLUX_WEB_TAG}: Initializing ---"
echo "  repo: $REPO_ROOT"
if grep -Eq '^\s*FLUX_TENANT_PROBE_GATEWAY_URL=' "$REPO_ROOT/docker/web/.env" 2>/dev/null; then
  echo "  tenant_probe_gateway: configured"
else
  echo "  WARN: FLUX_TENANT_PROBE_GATEWAY_URL is not set in docker/web/.env"
  echo "        Set it to http://flux-node-gateway:4000 to reduce false Offline mesh status."
fi

# 1. Optional: synchronize with origin (skip locally if unset)
if [[ "${FLUX_DEPLOY_GIT_SYNC:-}" == "1" ]]; then
  echo "--- Flux ${FLUX_WEB_TAG}: Git sync (ff-only) ---"
  if [[ ! -d "$REPO_ROOT/.git" ]]; then
    echo "  skip: not a git checkout"
  else
    git -C "$REPO_ROOT" pull --ff-only
  fi
fi

# 2–4. Build (unless restart-only), cycle, prune
if [[ "${FLUX_DEPLOY_RESTART_ONLY:-}" == "1" ]]; then
  echo "--- Flux ${FLUX_WEB_TAG}: Cycling container (no image build) ---"
  $COMPOSE up -d --remove-orphans --no-build
else
  echo "--- Flux ${FLUX_WEB_TAG}: Building control plane ($CONTAINER_NAME) ---"
  $COMPOSE build --pull

  echo "--- Flux ${FLUX_WEB_TAG}: Cycling container ---"
  $COMPOSE up -d --remove-orphans

  echo "--- Flux ${FLUX_WEB_TAG}: Pruning dangling images ---"
  docker image prune -f

  if [[ "${FLUX_DEPLOY_PRUNE_BUILDER:-}" == "1" ]]; then
    echo "--- Flux ${FLUX_WEB_TAG}: Pruning build cache (builder) ---"
    docker builder prune -f
  else
    echo "  (Set FLUX_DEPLOY_PRUNE_BUILDER=1 to also prune docker build cache to save more disk.)"
  fi
fi

# 5. Health check
echo "--- Flux ${FLUX_WEB_TAG}: Verifying container ---"
sleep 5
RUNNING="$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || echo false)"
if [[ "$RUNNING" != "true" ]]; then
  STATUS="$(docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo missing)"
  echo "  ERROR: $CONTAINER_NAME is not running (State.Running=$RUNNING status=$STATUS)" >&2
  docker ps -a --filter "name=^${CONTAINER_NAME}\$" || true
  exit 1
fi
echo "  $CONTAINER_NAME: running"
docker ps --filter "name=^${CONTAINER_NAME}\$" --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'

# 6. Ingress / router verification (Traefik labels + network + Host probe)
echo "--- Flux ${FLUX_WEB_TAG}: Verifying gateway route ---"
if ! docker ps --format '{{.Names}}' | grep -qxF "${GATEWAY_NAME}"; then
  echo "  WARN: Gateway container '${GATEWAY_NAME}' is not running."
  echo "        Traefik must be up to route ${CHECK_HOST}."
else
  if docker inspect "$CONTAINER_NAME" --format '{{json .NetworkSettings.Networks}}' | grep -q "\"flux-network\""; then
    echo "  network: ${CONTAINER_NAME} attached to flux-network"
  else
    echo "  WARN: ${CONTAINER_NAME} is not attached to flux-network."
    echo "        Traefik cannot reach the dashboard service on docker provider."
  fi

  LABEL_RULE="$(docker inspect -f '{{ index .Config.Labels "traefik.http.routers.flux-web.rule" }}' "$CONTAINER_NAME" 2>/dev/null || true)"
  if [[ -n "${LABEL_RULE:-}" ]]; then
    echo "  router: flux-web label present"
  else
    echo "  WARN: Missing traefik router labels on ${CONTAINER_NAME}."
  fi

  if command -v curl >/dev/null 2>&1; then
    HTTP_CODE="$(curl -sS -o /dev/null -w "%{http_code}" -H "Host: ${CHECK_HOST}" "http://127.0.0.1/" || echo "000")"
    # 301/308: common HTTP→HTTPS at the edge; 302/307: temporary redirects; 200: direct hit.
    if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "301" || "$HTTP_CODE" == "302" || "$HTTP_CODE" == "307" || "$HTTP_CODE" == "308" ]]; then
      echo "  route: OK (http://127.0.0.1 Host=${CHECK_HOST} -> ${HTTP_CODE})"
    else
      echo "  WARN: Gateway route probe failed (http code ${HTTP_CODE}) for Host=${CHECK_HOST}."
      echo "        If this is 404 Service Not Found, Traefik has no matching router/service for this host."
      echo "        Check: docker logs ${GATEWAY_NAME} --since 3m"
      echo "               docker inspect ${CONTAINER_NAME} --format '{{json .Config.Labels}}' | jq"
    fi
  else
    echo "  WARN: curl not found; skipped local gateway probe."
  fi
fi

echo ""
echo "--- Flux ${FLUX_WEB_TAG}: Operational ---"
echo "  logs:  docker logs -f $CONTAINER_NAME"
echo "  check: docker inspect $CONTAINER_NAME --format '{{.State.Health.Status}}'   # if HEALTHCHECK is added"

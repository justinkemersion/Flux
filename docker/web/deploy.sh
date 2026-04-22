#!/bin/bash
# Rebuild and restart the Flux control plane (Next.js dashboard + embedded CLI build).
# Run on the host where Docker runs (e.g. Hetzner) after the repo is present at $REPO_ROOT.
#
#   FLUX_DEPLOY_GIT_SYNC=1    —  run `git pull --ff-only` in the repo first (convenience on a server).
#   FLUX_DEPLOY_PRUNE_BUILDER=1 —  also `docker builder prune -f` (frees more NVMe; next build is colder).
#
# Prerequisite: `docker/web/.env` exists, Traefik + external network `flux-network` (see repo docs).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

COMPOSE="docker compose -f docker/web/docker-compose.yml"
# Must match `container_name` in docker/web/docker-compose.yml
CONTAINER_NAME="flux-web"

echo "--- Flux Deploy: Initializing ---"
echo "  repo: $REPO_ROOT"

# 1. Optional: synchronize with origin (skip locally if unset)
if [[ "${FLUX_DEPLOY_GIT_SYNC:-}" == "1" ]]; then
  echo "--- Flux Deploy: Git sync (ff-only) ---"
  if [[ ! -d "$REPO_ROOT/.git" ]]; then
    echo "  skip: not a git checkout"
  else
    git -C "$REPO_ROOT" pull --ff-only
  fi
fi

# 2. Build image (--pull: refresh base image layers; context is repo root for Dockerfile + CLI)
echo "--- Flux Deploy: Building control plane ($CONTAINER_NAME) ---"
$COMPOSE build --pull

# 3. Deterministic restart
echo "--- Flux Deploy: Cycling container ---"
$COMPOSE up -d --remove-orphans

# 4. Prune
echo "--- Flux Deploy: Pruning dangling images ---"
docker image prune -f

if [[ "${FLUX_DEPLOY_PRUNE_BUILDER:-}" == "1" ]]; then
  echo "--- Flux Deploy: Pruning build cache (builder) ---"
  docker builder prune -f
else
  echo "  (Set FLUX_DEPLOY_PRUNE_BUILDER=1 to also prune docker build cache to save more disk.)"
fi

# 5. Health check
echo "--- Flux Deploy: Verifying container ---"
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

echo ""
echo "--- Flux Deploy: Operational ---"
echo "  logs:  docker logs -f $CONTAINER_NAME"
echo "  check: docker inspect $CONTAINER_NAME --format '{{.State.Health.Status}}'   # if HEALTHCHECK is added"

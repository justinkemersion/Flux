#!/bin/bash
# Apply the Flux edge proxy configuration. Traefik reloads catalog-derived v2
# tenant routers from its watched named volume without subsequent restarts.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker/traefik/docker-compose.yml"

if ! docker network inspect flux-network >/dev/null 2>&1; then
  docker network create flux-network >/dev/null
fi

docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

if [[ "$(docker inspect -f '{{.State.Running}}' flux-gateway 2>/dev/null || true)" != "true" ]]; then
  echo "ERROR: flux-gateway did not reach running state." >&2
  docker logs --tail 50 flux-gateway >&2 || true
  exit 1
fi

echo "Traefik edge ready (dynamic v2 tenant directory enabled)."

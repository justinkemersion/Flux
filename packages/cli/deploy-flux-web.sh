#!/bin/bash
# One-shot deploy for the Flux dashboard (flux-web) at https://flux.vsl-base.com.
# Assumes the remote already has Traefik (flux-gateway) on `flux-network` and
# /srv/platform/flux/docker/web/.env populated (see docker/web/.env.example).
set -euo pipefail

REMOTE=${REMOTE:-root@178.104.205.138}
APP_DIR=${APP_DIR:-/srv/platform/flux}
BRANCH=${BRANCH:-main}

echo "Syncing repo on $REMOTE ($APP_DIR @ origin/$BRANCH)..."
# The -A flag explicitly enables SSH Agent Forwarding so git can pull
ssh -A "$REMOTE" "cd $APP_DIR && git fetch --all --prune && git reset --hard origin/$BRANCH"

echo "Checking server-side .env..."
ssh -A "$REMOTE" "test -f $APP_DIR/docker/web/.env" || {
  echo "ERROR: $APP_DIR/docker/web/.env missing on $REMOTE."
  echo "       Create it from docker/web/.env.example before deploying."
  exit 1
}

echo "Building and starting flux-web..."
ssh -A "$REMOTE" "cd $APP_DIR && docker compose -f docker/web/docker-compose.yml build && docker compose -f docker/web/docker-compose.yml up -d"

echo
echo "Deployed."
echo "  URL:  https://flux.vsl-base.com"
echo "  Logs: ssh $REMOTE 'docker logs -f flux-web'"

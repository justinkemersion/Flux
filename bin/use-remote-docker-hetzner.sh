#!/usr/bin/env bash
# Point the Docker CLI at the Hetzner host (same as legacy set-hetzner-env-vars behavior).
#
# Must be *sourced*:
#   source ./bin/use-remote-docker-hetzner.sh
#
# Optional override:
#   FLUX_REMOTE_DOCKER_SSH=ssh://root@other-host ./bin/use-remote-docker-hetzner.sh   # (still source it)
#
set +u
unset DOCKER_CONTEXT
set -u

REMOTE="${FLUX_REMOTE_DOCKER_SSH:-ssh://root@178.104.205.138}"
export DOCKER_HOST="$REMOTE"

echo "Docker → remote: DOCKER_HOST=$DOCKER_HOST  context=$(docker context show) (host wins over context)"

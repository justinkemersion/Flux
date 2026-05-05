#!/usr/bin/env bash
# Reset the Docker CLI to this machine's engine.
#
# IMPORTANT: Must be *sourced* so your current shell drops DOCKER_HOST / DOCKER_CONTEXT:
#   source ./bin/use-local-docker.sh
#   . ./bin/use-local-docker.sh
#
# `docker context use default` alone is NOT enough if DOCKER_HOST is still exported
# (Docker honors DOCKER_HOST over the context endpoint).
#
set +u
unset DOCKER_HOST
unset DOCKER_CONTEXT
set -u

docker context use default

echo "Docker → local: context=$(docker context show)  DOCKER_HOST=${DOCKER_HOST:-<unset>}  DOCKER_CONTEXT=${DOCKER_CONTEXT:-<unset>}"

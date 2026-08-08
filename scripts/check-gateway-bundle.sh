#!/usr/bin/env bash
# Assert the gateway's esbuild output carries no Docker/SSH dependencies.
#
# The gateway ships as a single bundle on a slim image. `ssh2` is marked external in
# packages/gateway/Dockerfile and is not installed there, so if anything drags
# dockerode/docker-modem into the bundle the container crash-loops at startup with
# "Cannot find module 'ssh2'". tsc and the unit suite never build the bundle, so this
# is the only layer that can catch it.
#
# scripts/check-architecture.ts forbids the @flux/core root barrel in gateway sources,
# which is the known cause. This checks the artifact itself, for causes we have not
# thought of. Keep the esbuild flags in sync with packages/gateway/Dockerfile.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="$(mktemp -d)"
trap 'rm -rf "$OUT_DIR"' EXIT
OUT="${OUT_DIR}/server.cjs"

pnpm dlx esbuild packages/gateway/src/server.ts \
  --bundle \
  --platform=node \
  --format=cjs \
  --outfile="$OUT" \
  --external:pg \
  --external:ioredis \
  --external:cpu-features \
  --external:ssh2 >/dev/null 2>&1

if [[ ! -s "$OUT" ]]; then
  echo "error: gateway bundle was not produced" >&2
  exit 1
fi

if grep -qE 'docker-modem|dockerode|require\("ssh2"\)' "$OUT"; then
  echo "error: gateway bundle contains Docker/SSH dependencies." >&2
  echo "       The runtime image does not carry ssh2, so the container will crash-loop." >&2
  echo "       Import @flux/core via a subpath instead of the root barrel." >&2
  grep -oE 'docker-modem|dockerode|ssh2' "$OUT" | sort | uniq -c >&2
  exit 1
fi

echo "gateway bundle: no Docker/SSH dependencies"

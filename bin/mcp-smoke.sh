#!/usr/bin/env bash
# MCP v0.1 contract smoke — offline by default; hosted probes with --hosted.
#
# Offline (always):
#   pnpm --filter @flux/mcp test
#
# Hosted (--hosted, requires env):
#   FLUX_MCP_TOKEN          scoped read/plan token
#   FLUX_MCP_SMOKE_HASH     7-char hex project in token scope
#   FLUX_API_BASE           optional (default https://flux.vsl-base.com/api)
#
# Examples:
#   ./bin/mcp-smoke.sh
#   FLUX_MCP_TOKEN=… FLUX_MCP_SMOKE_HASH=… ./bin/mcp-smoke.sh --hosted
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

HOSTED=0
for arg in "$@"; do
  if [[ "$arg" == "--hosted" ]]; then
    HOSTED=1
  fi
done

echo "=== MCP smoke: offline contract tests ==="
pnpm --filter @flux/mcp test

if [[ "$HOSTED" -eq 0 ]]; then
  echo ""
  echo "offline contract tests: PASS"
  echo "destructive tools absent: PASS"
  echo ""
  echo "SKIP: hosted probes (pass --hosted with FLUX_MCP_TOKEN and FLUX_MCP_SMOKE_HASH)"
  exit 0
fi

if [[ -z "${FLUX_MCP_TOKEN:-}" || -z "${FLUX_MCP_SMOKE_HASH:-}" ]]; then
  echo "FAIL: --hosted requires FLUX_MCP_TOKEN and FLUX_MCP_SMOKE_HASH" >&2
  exit 1
fi

echo "=== MCP smoke: hosted probes ==="
pnpm --filter @flux/mcp exec tsx src/scripts/run-mcp-smoke-hosted.ts

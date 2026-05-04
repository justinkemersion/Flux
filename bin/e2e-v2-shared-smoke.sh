#!/usr/bin/env bash
# Minimal smoke: HTTP client → Flux gateway → pooled PostgREST → shared Postgres.
#
# Prerequisites (real stack, no shims):
#   - Gateway listening at FLUX_SMOKE_GATEWAY_URL (default http://127.0.0.1:4000).
#   - FLUX_SMOKE_KNOWN_HOST set to a hostname that resolves in flux-system to a
#     v2_shared project (e.g. api--<slug>--<hash>.<base> or api.<slug>.<hash>.<base>).
#   - PostgREST pool and shared DB wired the same way production uses.
#
# Example:
#   FLUX_SMOKE_KNOWN_HOST=api--myproj--4f9aeaa.example.com \
#     ./bin/e2e-v2-shared-smoke.sh
#
# Optional: pass a tenant JWT if your pool rejects unauthenticated root:
#   FLUX_SMOKE_BEARER="$(... mint HS256 with project jwt_secret, sub, ...)" \
#     ./bin/e2e-v2-shared-smoke.sh
#
# GitHub Actions (opt-in, keeps default CI fast):
#   1) Manual: workflow "V2 gateway smoke" (workflow_dispatch) — enter gateway URL + host.
#   2) After green tests on main: set repo variable FLUX_SMOKE_CI=true and add secrets
#      FLUX_SMOKE_GATEWAY_URL, FLUX_SMOKE_KNOWN_HOST (optional FLUX_SMOKE_BEARER).
#      See .github/workflows/ci.yml job v2-gateway-smoke.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_URL="${FLUX_SMOKE_GATEWAY_URL:-http://127.0.0.1:4000}"
BASE_URL="${BASE_URL%/}"
KNOWN_HOST="${FLUX_SMOKE_KNOWN_HOST:-}"

if [[ -z "$KNOWN_HOST" ]]; then
  echo "error: set FLUX_SMOKE_KNOWN_HOST to the full API hostname the gateway should resolve" >&2
  exit 2
fi

echo "e2e v2 smoke: GET ${BASE_URL}/  Host: ${KNOWN_HOST}"

extra=()
if [[ -n "${FLUX_SMOKE_BEARER:-}" ]]; then
  extra+=(-H "Authorization: Bearer ${FLUX_SMOKE_BEARER}")
fi

code="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -H "Host: ${KNOWN_HOST}" \
    "${extra[@]}" \
    "${BASE_URL}/"
)"

if [[ "$code" -ge 200 && "$code" -lt 300 ]]; then
  echo "ok: gateway returned HTTP ${code} (PostgREST reached)"
  exit 0
fi

echo "error: expected 2xx, got HTTP ${code}" >&2
exit 1

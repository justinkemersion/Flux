#!/usr/bin/env bash
# Pass 2 — destructive backup gate smoke (non-destructive on live).
#
# Part A (always): unit tests for route handler gate ordering and 412 responses.
# Part B (optional): live CLI probes that must stop at HTTP 412 — never completes delete/migrate.
#
# Live prerequisites:
#   FLUX_API_TOKEN          — CLI Bearer key (same as `flux login`)
#   FLUX_PASS2_SMOKE_HASH   — 7-char hex project hash you own (must lack restorable backup)
#   FLUX_PASS2_SMOKE_SLUG   — matching project slug
#   FLUX_DASHBOARD_BASE     — default http://127.0.0.1:3000 (use http://flux-web:3000 from Compose network)
#
# Example (from host with dashboard on :3000):
#   FLUX_API_TOKEN=… FLUX_PASS2_SMOKE_SLUG=static FLUX_PASS2_SMOKE_HASH=64a02b4 \
#     FLUX_DASHBOARD_BASE=http://127.0.0.1:3000 ./bin/pass2-destructive-gate-smoke.sh
#
# Example (inside flux-web on production — read-only gate check):
#   docker exec -e FLUX_API_TOKEN=… -e FLUX_PASS2_SMOKE_SLUG=static \
#     -e FLUX_PASS2_SMOKE_HASH=64a02b4 -e FLUX_DASHBOARD_BASE=http://127.0.0.1:3000 \
#     flux-web /srv/platform/flux/bin/pass2-destructive-gate-smoke.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== Pass 2 smoke: unit tests (destructive route handlers) ==="
pnpm --filter dashboard exec tsx --test src/lib/destructive-project-routes.test.ts

expect_http() {
  local label=$1
  local method=$2
  local url=$3
  local expect=$4
  local body=${5:-}

  local code
  if [[ -n "$body" ]]; then
    code="$(
      curl -sS -o /tmp/pass2-smoke-body.json -w "%{http_code}" \
        -X "$method" \
        -H "Authorization: Bearer ${FLUX_API_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "$body" \
        "$url" || echo "000"
    )"
  else
    code="$(
      curl -sS -o /tmp/pass2-smoke-body.json -w "%{http_code}" \
        -X "$method" \
        -H "Authorization: Bearer ${FLUX_API_TOKEN}" \
        "$url" || echo "000"
    )"
  fi

  if [[ "$code" != "$expect" ]]; then
    echo "FAIL: $label — expected HTTP $expect, got $code" >&2
    head -c 400 /tmp/pass2-smoke-body.json >&2 || true
    echo >&2
    return 1
  fi
  echo "ok: $label — HTTP $code"
}

if [[ -z "${FLUX_API_TOKEN:-}" || -z "${FLUX_PASS2_SMOKE_HASH:-}" || -z "${FLUX_PASS2_SMOKE_SLUG:-}" ]]; then
  echo ""
  echo "skip: live CLI gate probes (set FLUX_API_TOKEN, FLUX_PASS2_SMOKE_SLUG, FLUX_PASS2_SMOKE_HASH)"
  exit 0
fi

BASE="${FLUX_DASHBOARD_BASE:-http://127.0.0.1:3000}"
BASE="${BASE%/}"
HASH="${FLUX_PASS2_SMOKE_HASH,,}"
SLUG="${FLUX_PASS2_SMOKE_SLUG}"

echo ""
echo "=== Pass 2 smoke: live CLI gate probes (412 only — no destructive completion) ==="
echo "  base: $BASE  slug: $SLUG  hash: $HASH"

expect_http "CLI DELETE blocked without backup" DELETE \
  "${BASE}/api/cli/v1/projects/${HASH}" 412

expect_http "CLI migrate blocked without backup" POST \
  "${BASE}/api/cli/v1/migrate" 412 \
  "{\"slug\":\"${SLUG}\",\"hash\":\"${HASH}\",\"dryRun\":false}"

code="$(
  curl -sS -o /tmp/pass2-smoke-body.json -w "%{http_code}" \
    -X DELETE \
    "${BASE}/api/cli/v1/projects/${HASH}" || echo "000"
)"
if [[ "$code" != "401" ]]; then
  echo "FAIL: CLI DELETE unauthorized without token — expected HTTP 401, got $code" >&2
  head -c 400 /tmp/pass2-smoke-body.json >&2 || true
  echo >&2
  exit 1
fi
echo "ok: CLI DELETE unauthorized without token — HTTP 401"

echo ""
echo "Pass 2 destructive gate smoke: OK"

#!/usr/bin/env bash
# Private database access smoke (Pass 1 + Pass 2).
#
# Part A (always): unit tests for access plans, role SQL, temp credential broker, CLI format.
# Part B (optional): live API + CLI probes against a deployed control plane.
#
# Live prerequisites:
#   FLUX_API_TOKEN                 — CLI Bearer key (same as `flux login`)
#   FLUX_DB_ACCESS_SMOKE_HASH      — 7-char hex project hash you own
#   FLUX_DB_ACCESS_SMOKE_SLUG      — matching project slug
#   FLUX_DASHBOARD_BASE            — default https://flux.vsl-base.com
#
# Optional v1 dedicated probes:
#   FLUX_DB_ACCESS_SMOKE_V1_HASH / FLUX_DB_ACCESS_SMOKE_V1_SLUG
#
# Optional tunnel probe (requires SSH to FLUX_DB_TUNNEL_SSH_HOST or DOCKER_HOST=ssh://…):
#   FLUX_DB_ACCESS_SMOKE_TUNNEL=1
#
# Example:
#   FLUX_API_TOKEN=… FLUX_DB_ACCESS_SMOKE_SLUG=bloom-atelier FLUX_DB_ACCESS_SMOKE_HASH=61d9dff \
#     ./bin/db-access-smoke.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== db-access smoke: unit tests ==="
pnpm --filter @flux/core exec tsx --test \
  src/projects/database-access.test.ts \
  src/projects/db-access-roles.test.ts
pnpm --filter @flux/engine-v2 exec tsx --test src/db-access.test.ts
pnpm --filter dashboard exec tsx --test \
  src/lib/project-db-access.test.ts \
  src/lib/project-db-temp-credentials.test.ts \
  src/lib/project-db-access-copy.test.ts
pnpm --filter @flux/cli exec tsx --test src/db-access/format.test.ts

expect_http() {
  local label=$1
  local method=$2
  local url=$3
  local expect=$4
  local body=${5:-}
  local auth_mode=${6:-bearer}

  local code
  if [[ -n "$body" ]]; then
    if [[ "$auth_mode" == "noauth" ]]; then
      code="$(
        curl -sS -o /tmp/db-access-smoke-body.json -w "%{http_code}" \
          -X "$method" \
          -H "Content-Type: application/json" \
          -d "$body" \
          "$url" || echo "000"
      )"
    else
      code="$(
        curl -sS -o /tmp/db-access-smoke-body.json -w "%{http_code}" \
          -X "$method" \
          -H "Authorization: Bearer ${FLUX_API_TOKEN}" \
          -H "Content-Type: application/json" \
          -d "$body" \
          "$url" || echo "000"
      )"
    fi
  else
    if [[ "$auth_mode" == "noauth" ]]; then
      code="$(
        curl -sS -o /tmp/db-access-smoke-body.json -w "%{http_code}" \
          -X "$method" \
          "$url" || echo "000"
      )"
    else
      code="$(
        curl -sS -o /tmp/db-access-smoke-body.json -w "%{http_code}" \
          -X "$method" \
          -H "Authorization: Bearer ${FLUX_API_TOKEN}" \
          "$url" || echo "000"
      )"
    fi
  fi

  if [[ "$code" != "$expect" ]]; then
    echo "FAIL: $label — expected HTTP $expect, got $code" >&2
    head -c 600 /tmp/db-access-smoke-body.json >&2 || true
    echo >&2
    return 1
  fi
  echo "ok: $label — HTTP $code"
}

assert_json_field() {
  local label=$1
  local jq_expr=$2
  if ! node -e "
    const fs = require('node:fs');
    const raw = fs.readFileSync('/tmp/db-access-smoke-body.json', 'utf8');
    const data = JSON.parse(raw);
    const ok = (${jq_expr});
    if (!ok) process.exit(2);
  "; then
    echo "FAIL: $label — JSON assertion failed" >&2
    head -c 600 /tmp/db-access-smoke-body.json >&2 || true
    echo >&2
    return 1
  fi
  echo "ok: $label"
}

if [[ -z "${FLUX_API_TOKEN:-}" || -z "${FLUX_DB_ACCESS_SMOKE_HASH:-}" || -z "${FLUX_DB_ACCESS_SMOKE_SLUG:-}" ]]; then
  echo ""
  echo "skip: live db-access probes (set FLUX_API_TOKEN, FLUX_DB_ACCESS_SMOKE_SLUG, FLUX_DB_ACCESS_SMOKE_HASH)"
  exit 0
fi

BASE="${FLUX_DASHBOARD_BASE:-https://flux.vsl-base.com}"
BASE="${BASE%/}"
HASH="${FLUX_DB_ACCESS_SMOKE_HASH,,}"
SLUG="${FLUX_DB_ACCESS_SMOKE_SLUG}"

echo ""
echo "=== db-access smoke: live API probes ==="
echo "  base: $BASE  slug: $SLUG  hash: $HASH"

expect_http "GET db-access plan (v2)" GET \
  "${BASE}/api/cli/v1/projects/${HASH}/db-access" 200
assert_json_field "v2 plan supported + temp creds capability" \
  "data.mode === 'v2_shared' && data.supported === true && data.capabilities.temporaryCredentials === true"
assert_json_field "plan JSON has no connection string secrets" \
  "!JSON.stringify(data).match(/postgresql:\\/\\//i)"

expect_http "POST temporary credential readonly" POST \
  "${BASE}/api/cli/v1/projects/${HASH}/db-access/temporary-credential" 200 \
  '{"access":"readonly","ttlSeconds":900}'
assert_json_field "temp credential shape" \
  "typeof data.username === 'string' && typeof data.password === 'string' && data.access === 'readonly' && typeof data.expiresAt === 'string' && typeof data.tenantSchema === 'string'"

expect_http "POST readwrite blocked when platform policy off" POST \
  "${BASE}/api/cli/v1/projects/${HASH}/db-access/temporary-credential" 403 \
  '{"access":"readwrite","ttlSeconds":900}'

expect_http "GET db-access unauthorized without token" GET \
  "${BASE}/api/cli/v1/projects/${HASH}/db-access" 401 "" "noauth"

echo ""
echo "=== db-access smoke: live CLI probes ==="
export FLUX_API_BASE="${BASE}/api"
pnpm --filter @flux/cli exec tsx src/index.ts db access-plan "$SLUG" --hash "$HASH" >/tmp/db-access-smoke-cli-plan.txt
grep -q "v2_shared" /tmp/db-access-smoke-cli-plan.txt
grep -q "Supported: true" /tmp/db-access-smoke-cli-plan.txt
echo "ok: flux db access-plan"

pnpm --filter @flux/cli exec tsx src/index.ts db gui-config "$SLUG" --hash "$HASH" --create-temp-credentials --json >/tmp/db-access-smoke-cli-gui.json
node -e "
  const fs = require('node:fs');
  const data = JSON.parse(fs.readFileSync('/tmp/db-access-smoke-cli-gui.json', 'utf8'));
  if (!data.credential?.username || !data.credential?.password) process.exit(2);
  if (!JSON.stringify(data).includes(data.credential.password)) process.exit(3);
"
echo "ok: flux db gui-config --create-temp-credentials"

if [[ -n "${FLUX_DB_ACCESS_SMOKE_V1_HASH:-}" && -n "${FLUX_DB_ACCESS_SMOKE_V1_SLUG:-}" ]]; then
  V1_HASH="${FLUX_DB_ACCESS_SMOKE_V1_HASH,,}"
  V1_SLUG="${FLUX_DB_ACCESS_SMOKE_V1_SLUG}"
  expect_http "GET v1 db-access plan" GET \
    "${BASE}/api/cli/v1/projects/${V1_HASH}/db-access" 200
  assert_json_field "v1 plan tunnel capability" \
    "data.mode === 'v1_dedicated' && data.capabilities.tunnel === true"
  pnpm --filter @flux/cli exec tsx src/index.ts db access-plan "$V1_SLUG" --hash "$V1_HASH" >/tmp/db-access-smoke-v1-plan.txt
  grep -q "v1_dedicated" /tmp/db-access-smoke-v1-plan.txt
  echo "ok: v1 flux db access-plan"
fi

if [[ "${FLUX_DB_ACCESS_SMOKE_TUNNEL:-}" == "1" ]]; then
  echo ""
  echo "=== db-access smoke: tunnel print-config ==="
  export FLUX_DB_TUNNEL_SSH_HOST="${FLUX_DB_TUNNEL_SSH_HOST:-178.104.205.138}"
  pnpm --filter @flux/cli exec tsx src/index.ts db tunnel "$SLUG" --hash "$HASH" --print-config >/tmp/db-access-smoke-tunnel.txt
  grep -q "Password:" /tmp/db-access-smoke-tunnel.txt
  grep -q "flux_temp_" /tmp/db-access-smoke-tunnel.txt
  echo "ok: flux db tunnel --print-config"
fi

echo ""
echo "db-access smoke: OK"

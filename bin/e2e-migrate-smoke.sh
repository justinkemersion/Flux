#!/usr/bin/env bash
# Smoke checklist for `flux migrate` (requires a live control plane + FLUX_SHARED_POSTGRES_URL).
# Does not run automatically in CI unless those secrets exist.
set -euo pipefail

if [[ -z "${FLUX_API_TOKEN:-}" || -z "${FLUX_DASHBOARD_BASE:-}" ]]; then
  echo "skip: set FLUX_API_TOKEN and FLUX_DASHBOARD_BASE to run migrate smoke"
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/packages/cli"

echo "1) dry-run"
pnpm --dir "$CLI" exec tsx src/index.ts migrate \
  -p "${FLUX_MIGRATE_SLUG:?set FLUX_MIGRATE_SLUG}" \
  --hash "${FLUX_MIGRATE_HASH:?set FLUX_MIGRATE_HASH}" \
  --dry-run

echo "OK (dry-run only — add --yes to execute)"

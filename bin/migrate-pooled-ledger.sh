#!/usr/bin/env bash
# Upgrade a legacy global flux.flux_migrations ledger to tenant-scoped (tenant_schema, version) PK.
#
# Required when directory `flux push` fails with:
#   flux.flux_migrations legacy global ledger has N row(s); tenant-scoped upgrade required
#
# Legacy rows were recorded before pooled fleets tracked tenant_schema. This script adds the
# column, backfills existing rows to one tenant schema, and replaces the primary key.
# Only run when those legacy rows all belong to the tenant you pass via --assign-legacy-to.
#
# Usage (on the Flux host, from repo root):
#   ./bin/migrate-pooled-ledger.sh --assign-legacy-to t_744b22df8382_api
#   ./bin/migrate-pooled-ledger.sh --assign-legacy-to t_744b22df8382_api --dry-run
#
# Environment:
#   FLUX_SHARED_POSTGRES_URL — direct psql connection (optional if flux-web container runs)
#   FLUX_WEB_CONTAINER       — override container name (default: flux-web)
#
# After structural upgrade, migrations applied outside the ledger (e.g. single-file push before
# the fix) may still need ledger rows inserted manually or via a fresh checksum-matching push.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ASSIGN_LEGACY_TO=""
DRY_RUN=0
CONTAINER="${FLUX_WEB_CONTAINER:-flux-web}"

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --assign-legacy-to)
      ASSIGN_LEGACY_TO="${2:?missing value for --assign-legacy-to}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage 1
      ;;
  esac
done

if [[ ! "$ASSIGN_LEGACY_TO" =~ ^t_[a-f0-9]+_api$ ]]; then
  echo "error: --assign-legacy-to must look like t_<shortId>_api (e.g. t_744b22df8382_api)" >&2
  exit 1
fi

load_postgres_url() {
  if [[ -n "${FLUX_SHARED_POSTGRES_URL:-}" ]]; then
    return 0
  fi
  local env_file="$REPO_ROOT/docker/web/.env"
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    set -a
    source "$env_file"
    set +a
  fi
  if [[ -z "${FLUX_SHARED_POSTGRES_URL:-}" ]]; then
    echo "error: set FLUX_SHARED_POSTGRES_URL or configure docker/web/.env" >&2
    exit 1
  fi
}

psql_exec() {
  local sql="$1"
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
    docker exec -i "$CONTAINER" psql "$FLUX_SHARED_POSTGRES_URL" -v ON_ERROR_STOP=1 -Atc "$sql"
  else
    psql "$FLUX_SHARED_POSTGRES_URL" -v ON_ERROR_STOP=1 -Atc "$sql"
  fi
}

psql_file() {
  local sql="$1"
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
    docker exec -i "$CONTAINER" psql "$FLUX_SHARED_POSTGRES_URL" -v ON_ERROR_STOP=1 <<<"$sql"
  else
    psql "$FLUX_SHARED_POSTGRES_URL" -v ON_ERROR_STOP=1 <<<"$sql"
  fi
}

load_postgres_url

echo "--- Flux pooled ledger upgrade ---"
echo "  assign legacy rows to: $ASSIGN_LEGACY_TO"
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  echo "  psql via container: $CONTAINER"
else
  echo "  psql: direct (no $CONTAINER container)"
fi

STATE="$(psql_exec "
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'flux' AND table_name = 'flux_migrations'
  )::text,
  COALESCE((
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'flux'
      AND table_name = 'flux_migrations'
      AND column_name = 'tenant_schema'
  ), 'missing'),
  COALESCE((SELECT COUNT(*)::text FROM flux.flux_migrations), '0'),
  COALESCE((
    SELECT COUNT(*)::text
    FROM flux.flux_migrations
    WHERE tenant_schema IS NULL
  ), '0');
")"

IFS='|' read -r TABLE_EXISTS TENANT_NULLABLE ROW_COUNT NULL_ROWS <<<"$STATE"

if [[ "$TABLE_EXISTS" != "t" ]]; then
  echo "OK: flux.flux_migrations does not exist — first pooled push will create tenant-scoped ledger"
  exit 0
fi

if [[ "$TENANT_NULLABLE" == "NO" && "$NULL_ROWS" == "0" ]]; then
  echo "OK: ledger already tenant-scoped ($ROW_COUNT row(s) for all tenants)"
  exit 0
fi

if [[ "$TENANT_NULLABLE" == "missing" && "$ROW_COUNT" == "0" ]]; then
  echo "OK: empty legacy ledger — directory batch push will auto-upgrade on next run"
  exit 0
fi

echo "  current rows: $ROW_COUNT (without tenant_schema: $NULL_ROWS)"

UPGRADE_SQL="$(pnpm --dir "$REPO_ROOT/packages/core" exec tsx -e "
import { buildPooledLedgerUpgradeSql } from './src/sql-migrations.ts';
console.log(buildPooledLedgerUpgradeSql(process.argv[1]));
" "$ASSIGN_LEGACY_TO")"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "--- dry-run: would execute ---"
  echo "$UPGRADE_SQL"
  exit 0
fi

echo "--- applying upgrade ---"
psql_file "$UPGRADE_SQL"
echo "OK: flux.flux_migrations is now tenant-scoped"
echo "Next: run \`flux push sql/migrations/\` per project; insert missing ledger rows if single-file pushes bypassed the ledger."

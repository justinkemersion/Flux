#!/usr/bin/env bash
# Pass 6b reconciliation — read-only operator check for the tenant privilege model.
#
# Reports, per tenant schema on the shared cluster:
#   - whether it has a flux-system catalog row (orphan detection)
#   - whether the runtime and DDL roles exist
#   - the schema owner
#   - objects still owned by the runtime role (must be zero — owners bypass RLS)
#   - RLS-enabled tables missing FORCE ROW LEVEL SECURITY
#
# Read-only: no DDL, no writes. Safe against production.
#
# Usage:
#   ./bin/pass6b-reconcile-tenant-roles.sh                 # human-readable report
#   ./bin/pass6b-reconcile-tenant-roles.sh --backfill-set  # catalogued schemas, one per line
#
# Env:
#   FLUX_V2_PG_CONTAINER      shared cluster container (default: flux-postgres-v2)
#   FLUX_SYSTEM_PG_CONTAINER  flux-system container    (required; e.g. flux-<hash>-flux-system-db)
#   FLUX_V2_PG_USER / FLUX_V2_PG_DB / FLUX_SYSTEM_PG_USER / FLUX_SYSTEM_PG_DB
set -euo pipefail

V2_CONTAINER="${FLUX_V2_PG_CONTAINER:-flux-postgres-v2}"
V2_USER="${FLUX_V2_PG_USER:-postgres}"
V2_DB="${FLUX_V2_PG_DB:-postgres}"
SYS_CONTAINER="${FLUX_SYSTEM_PG_CONTAINER:-}"
SYS_USER="${FLUX_SYSTEM_PG_USER:-postgres}"
SYS_DB="${FLUX_SYSTEM_PG_DB:-postgres}"
MODE="${1:-report}"

if [[ -z "$SYS_CONTAINER" ]]; then
  echo "FLUX_SYSTEM_PG_CONTAINER is required (the flux-system catalog container)." >&2
  echo "Without it, every schema would be misreported as an orphan." >&2
  exit 2
fi

# Canonical schema name = 't_' || first 12 hex of the project uuid || '_api'.
# A failure here must abort: a partial catalog silently turns live tenants into
# "orphans" and would exclude them from the backfill set.
if ! catalog_raw=$(docker exec -i "$SYS_CONTAINER" psql -U "$SYS_USER" -d "$SYS_DB" -tAc \
  "SELECT 't_' || substr(replace(id::text, '-', ''), 1, 12) || '_api' FROM projects;" 2>&1); then
  echo "Failed to read the flux-system catalog: ${catalog_raw}" >&2
  exit 2
fi

mapfile -t CATALOGUED < <(printf '%s\n' "$catalog_raw" | grep -E '^t_[0-9a-f]{12}_api$' | sort -u)
if [[ ${#CATALOGUED[@]} -eq 0 ]]; then
  echo "The catalog returned no tenant schemas — refusing to report everything as orphaned." >&2
  exit 2
fi

# Inject the catalog as a VALUES list so the whole report is one round trip.
catalog_values=$(printf "('%s')," "${CATALOGUED[@]}")
catalog_values="${catalog_values%,}"

REPORT_SQL="
WITH catalogued(nspname) AS (VALUES ${catalog_values}),
present AS (
  SELECT n.oid, n.nspname, pg_get_userbyid(n.nspowner) AS owner,
         -- 't_<12hex>_api' -> 't_<12hex>_', so the role names append 'role' / 'ddl'.
         left(n.nspname, length(n.nspname) - 3) AS prefix
  FROM pg_namespace n
  WHERE n.nspname ~ '^t_[0-9a-f]{12}_api$'
)
SELECT p.nspname,
       CASE WHEN c.nspname IS NULL THEN 'orphan' ELSE 'catalogued' END,
       EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = p.prefix || 'role'),
       EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = p.prefix || 'ddl'),
       p.owner,
       (SELECT count(*) FROM pg_class k WHERE k.relnamespace = p.oid
          AND pg_get_userbyid(k.relowner) = p.prefix || 'role'),
       (SELECT count(*) FROM pg_class k WHERE k.relnamespace = p.oid AND k.relkind = 'r'
          AND k.relrowsecurity AND NOT k.relforcerowsecurity),
       (SELECT count(*) FROM pg_class k WHERE k.relnamespace = p.oid AND k.relkind = 'r')
FROM present p
LEFT JOIN catalogued c ON c.nspname = p.nspname
ORDER BY 1;"

rows=$(docker exec -i "$V2_CONTAINER" psql -U "$V2_USER" -d "$V2_DB" -tAF'|' -c "$REPORT_SQL")

if [[ "$MODE" == "--backfill-set" ]]; then
  # Intersection only: schemas that exist AND have a catalog row. Orphans are excluded
  # so the backfill never strengthens infrastructure nothing points at.
  printf '%s\n' "$rows" | awk -F'|' '$2=="catalogued" {print $1}'
  exit 0
fi

printf '%-22s %-11s %-8s %-8s %-20s %6s %9s %7s\n' \
  SCHEMA CATALOG RUNTIME DDLROLE OWNER TABLES RT_OWNED UNFORCED
printf '%s\n' "$rows" | awk -F'|' '{
  printf "%-22s %-11s %-8s %-8s %-20s %6s %9s %7s\n",
    $1, $2, ($3=="t"?"yes":"NO"), ($4=="t"?"yes":"NO"), $5, $8, $6, $7
}'

echo
echo "RT_OWNED must be 0 everywhere: an object owned by the runtime role bypasses RLS"
echo "for that same role at request time. UNFORCED counts RLS tables without FORCE."
printf 'catalogued=%s present=%s\n' \
  "${#CATALOGUED[@]}" "$(printf '%s\n' "$rows" | grep -c .)"

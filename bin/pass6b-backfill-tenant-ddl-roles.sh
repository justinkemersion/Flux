#!/usr/bin/env bash
# Pass 6b backfill — per-tenant DDL/owner role for existing v2_shared tenants.
#
# Creates t_<12hex>_ddl, transfers ownership of the tenant schema and its objects to it,
# and attaches FOR ROLE default privileges so future pushes stay readable by the runtime
# role. Idempotent: safe to re-run.
#
# Only touches schemas passed on stdin (one per line). Deliberately does NOT discover
# schemas from the cluster — orphaned schemas with no catalog row must not be
# strengthened. Generate the input with pass6b-reconcile-tenant-roles.sh --backfill-set.
#
# MUST run BEFORE deploying the Pass 6 control plane. It is compatible with the
# currently deployed pre-Pass-6 code, which pushes as the control-plane role.
#
# Usage:
#   ./bin/pass6b-reconcile-tenant-roles.sh --backfill-set \
#     | ./bin/pass6b-backfill-tenant-ddl-roles.sh
#   ./bin/pass6b-backfill-tenant-ddl-roles.sh --dry-run < schemas.txt
#
# Env:
#   FLUX_V2_PG_CONTAINER   shared cluster container (default: flux-postgres-v2)
#   FLUX_V2_PG_USER        superuser role          (default: postgres)
#   FLUX_V2_PG_DB          database                (default: postgres)
set -euo pipefail

CONTAINER="${FLUX_V2_PG_CONTAINER:-flux-postgres-v2}"
PGUSER_="${FLUX_V2_PG_USER:-postgres}"
PGDB="${FLUX_V2_PG_DB:-postgres}"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

psql_run() {
  docker exec -i "$CONTAINER" psql -U "$PGUSER_" -d "$PGDB" -v ON_ERROR_STOP=1 "$@"
}

mapfile -t SCHEMAS < <(grep -E '^t_[0-9a-f]{12}_api$' || true)

if [[ ${#SCHEMAS[@]} -eq 0 ]]; then
  echo "No valid tenant schemas on stdin (expected t_<12hex>_api lines)." >&2
  exit 1
fi

echo "Pass 6b backfill: ${#SCHEMAS[@]} tenant schema(s) on ${CONTAINER}"
[[ $DRY_RUN -eq 1 ]] && echo "(dry run — printing SQL only)"

for schema in "${SCHEMAS[@]}"; do
  short="${schema#t_}"; short="${short%_api}"
  ddl="t_${short}_ddl"
  runtime="t_${short}_role"

  sql=$(cat <<EOSQL
BEGIN;

DO \$b\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ddl}') THEN
    CREATE ROLE "${ddl}" NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
\$b\$;

-- Guard: never strengthen a schema that has no runtime role (not a provisioned tenant).
DO \$g\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${runtime}') THEN
    RAISE EXCEPTION 'Refusing backfill: runtime role ${runtime} does not exist';
  END IF;
END
\$g\$;

ALTER SCHEMA "${schema}" OWNER TO "${ddl}";

-- Transfer existing objects. Scoped to this schema on purpose: REASSIGN OWNED BY is
-- cluster-wide for the role and would sweep unrelated objects.
DO \$own\$
DECLARE
  obj record;
BEGIN
  FOR obj IN
    SELECT c.oid::regclass AS ident, c.relkind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = '${schema}' AND c.relkind IN ('r','p','v','m','S')
  LOOP
    IF obj.relkind IN ('r','p') THEN
      EXECUTE format('ALTER TABLE %s OWNER TO %I', obj.ident, '${ddl}');
    ELSIF obj.relkind = 'v' THEN
      EXECUTE format('ALTER VIEW %s OWNER TO %I', obj.ident, '${ddl}');
    ELSIF obj.relkind = 'm' THEN
      EXECUTE format('ALTER MATERIALIZED VIEW %s OWNER TO %I', obj.ident, '${ddl}');
    ELSE
      EXECUTE format('ALTER SEQUENCE %s OWNER TO %I', obj.ident, '${ddl}');
    END IF;
  END LOOP;

  FOR obj IN
    SELECT p.oid::regprocedure AS ident
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = '${schema}'
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO %I', obj.ident, '${ddl}');
  END LOOP;
END
\$own\$;

ALTER DEFAULT PRIVILEGES FOR ROLE "${ddl}" IN SCHEMA "${schema}" GRANT SELECT ON TABLES TO "${runtime}";
ALTER DEFAULT PRIVILEGES FOR ROLE "${ddl}" IN SCHEMA "${schema}" GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE "${ddl}" IN SCHEMA "${schema}" GRANT USAGE, SELECT ON SEQUENCES TO "${runtime}";
GRANT USAGE ON SCHEMA "${schema}" TO "${runtime}";
GRANT "${ddl}" TO CURRENT_USER;

-- Defence in depth: the owner/runtime split already restores RLS, but forcing it keeps
-- the guarantee if ownership ever drifts. Tables without RLS are left alone.
DO \$rls\$
DECLARE
  target regclass;
BEGIN
  FOR target IN
    SELECT c.oid::regclass FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = '${schema}' AND c.relkind = 'r'
      AND c.relrowsecurity AND NOT c.relforcerowsecurity
      AND coalesce(obj_description(c.oid,'pg_class'),'') NOT LIKE '%flux:no-force-rls%'
  LOOP
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  END LOOP;
END
\$rls\$;

-- Fail the transaction if the runtime role still owns anything here.
DO \$assert\$
DECLARE
  bad int;
BEGIN
  SELECT count(*) INTO bad FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = '${schema}' AND pg_get_userbyid(c.relowner) = '${runtime}';
  IF bad > 0 THEN
    RAISE EXCEPTION 'Backfill failed: % object(s) still owned by runtime role ${runtime}', bad;
  END IF;
END
\$assert\$;

COMMIT;
EOSQL
)

  if [[ $DRY_RUN -eq 1 ]]; then
    echo "--- ${schema} ---"
    echo "$sql"
  else
    printf '%-22s ' "$schema"
    if echo "$sql" | psql_run -q; then echo "ok"; else echo "FAILED"; exit 1; fi
  fi
done

[[ $DRY_RUN -eq 0 ]] && echo "Backfill complete. Verify with: ./bin/pass6b-reconcile-tenant-roles.sh"
exit 0

/**
 * Grants and default privileges on the tenant API schema for PostgREST roles
 * (`anon`, `authenticated`, `service_role`).
 * Reused after {@link movePublicSchemaObjectsToTargetSchema} and in initial bootstrap SQL.
 */

import {
  assertFluxApiSchemaIdentifier,
  LEGACY_FLUX_API_SCHEMA,
} from "./api-schema-strategy.ts";

function qSchema(schema: string): string {
  assertFluxApiSchemaIdentifier(schema);
  return `"${schema.replace(/"/g, '""')}"`;
}

export function buildApiSchemaPrivilegesSql(apiSchemaName: string): string {
  const s = qSchema(apiSchemaName);
  return `
-- Allow request roles to use the API schema
GRANT USAGE ON SCHEMA ${s} TO anon, authenticated, service_role;

-- PostgREST may list public in PGRST_DB_SCHEMAS (e.g. Supabase); USAGE required for profile switching
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Existing tables / sequences
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${s} TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${s} TO anon, authenticated, service_role;

-- Objects created later in this schema (e.g. migrations) inherit these grants
ALTER DEFAULT PRIVILEGES IN SCHEMA ${s}
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ${s}
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ${s} GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ${s} GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ${s} GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ${s} GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ${s} GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ${s} GRANT ALL ON SEQUENCES TO service_role;
`.trim();
}

/** Legacy default: same identifier as `LEGACY_FLUX_API_SCHEMA` (existing v1 dedicated projects). */
export const API_SCHEMA_PRIVILEGES_SQL =
  buildApiSchemaPrivilegesSql(LEGACY_FLUX_API_SCHEMA);

export function buildDisableRowLevelSecurityForSchemaSql(
  apiSchemaName: string,
): string {
  assertFluxApiSchemaIdentifier(apiSchemaName);
  const lit = apiSchemaName.replace(/'/g, "''");
  return `
DO $flux_disable_tenant_rls$
DECLARE
  r RECORD;
  schema_const constant text := '${lit}';
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = schema_const
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I DISABLE ROW LEVEL SECURITY',
      schema_const,
      r.relname
    );
  END LOOP;
END
$flux_disable_tenant_rls$;
`.trim();
}

/**
 * Disables row-level security on every base/partitioned table in `api` that currently has RLS
 * enabled. Supabase dumps often ship with RLS policies that expect Supabase session roles and JWT
 * claims; PostgREST’s `anon` role may see no rows until policies are rewritten for Flux.
 */
export const DISABLE_ROW_LEVEL_SECURITY_FOR_RLS_ENABLED_API_TABLES_SQL =
  buildDisableRowLevelSecurityForSchemaSql(LEGACY_FLUX_API_SCHEMA);

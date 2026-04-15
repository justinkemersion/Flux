/**
 * Grants and default privileges on `api` for PostgREST roles (`anon`, `authenticated`).
 * Reused after {@link movePublicSchemaObjectsToApi} and in initial {@link BOOTSTRAP_SQL}.
 */
export const API_SCHEMA_PRIVILEGES_SQL = `
-- Allow request roles to use the api schema
GRANT USAGE ON SCHEMA api TO anon, authenticated;

-- PostgREST may list public in PGRST_DB_SCHEMAS (e.g. Supabase); USAGE required for profile switching
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Existing tables / sequences
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA api TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA api TO anon, authenticated;

-- Objects created later in this schema (e.g. migrations) inherit these grants
ALTER DEFAULT PRIVILEGES IN SCHEMA api
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA api
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA api GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA api GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA api GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA api GRANT ALL ON SEQUENCES TO authenticated;
`.trim();

/**
 * Disables row-level security on every base/partitioned table in `api` that currently has RLS
 * enabled. Supabase dumps often ship with RLS policies that expect Supabase session roles and JWT
 * claims; PostgREST’s `anon` role may see no rows until policies are rewritten for Flux. Use after
 * import when porting (e.g. YeastCoast) for local/testing, or replace with Flux-aware policies in
 * production.
 */
export const DISABLE_ROW_LEVEL_SECURITY_FOR_RLS_ENABLED_API_TABLES_SQL = `
DO $flux_disable_api_rls$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'api'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE api.%I DISABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END
$flux_disable_api_rls$;
`.trim();

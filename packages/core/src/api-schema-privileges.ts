/**
 * Grants and default privileges on `api` for PostgREST roles (`anon`, `authenticated`).
 * Reused after {@link movePublicSchemaObjectsToApi} and in initial {@link BOOTSTRAP_SQL}.
 */
export const API_SCHEMA_PRIVILEGES_SQL = `
-- Allow request roles to use the api schema
GRANT USAGE ON SCHEMA api TO anon, authenticated;

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

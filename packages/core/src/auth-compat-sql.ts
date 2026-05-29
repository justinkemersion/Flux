/**
 * Minimal `auth` schema and `auth.uid()` for Supabase-style RLS on Flux (PostgREST).
 * Returns JWT `sub` as **text** so Clerk / NextAuth string IDs work without casting from UUID.
 *
 * Reads `request.jwt.claims` (JSON) per PostgREST’s JWT → Postgres session mapping.
 */
export const FLUX_AUTH_SCHEMA_AND_UID_SQL = `
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS text
LANGUAGE sql
STABLE
AS $flux$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::text;
$flux$;

GRANT USAGE ON SCHEMA auth TO anon, authenticator;

DO $flux$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    GRANT USAGE ON SCHEMA auth TO authenticated;
  END IF;
END
$flux$;
`.trim();

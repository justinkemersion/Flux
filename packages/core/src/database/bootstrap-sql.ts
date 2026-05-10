import { FLUX_AUTH_SCHEMA_AND_UID_SQL } from "../auth-compat-sql.ts";
import { buildApiSchemaPrivilegesSql } from "../api-schema-privileges.ts";
import {
  assertFluxApiSchemaIdentifier,
  LEGACY_FLUX_API_SCHEMA,
} from "../api-schema-strategy.ts";

/**
 * One-time SQL run against every new Flux project database.
 *
 * Sets up the `api` schema and four roles that PostgREST expects:
 *   authenticator — the login role PostgREST connects as (no direct login for users)
 *   anon          — privileges for unauthenticated requests
 *   authenticated — privileges for JWT-verified requests
 *   service_role    — privileges for trusted server-side JWTs (CLI / migrate probes; BYPASSRLS)
 *
 * Installs Supabase-compatible **`auth`** schema and **`auth.uid()`** (returns **text**, JWT `sub`
 * from `request.jwt.claims`) for RLS with Clerk / NextAuth string IDs.
 *
 * Also grants on existing tables/sequences and sets ALTER DEFAULT PRIVILEGES so future objects in
 * `api` automatically grant DML to `anon` / `authenticated`, plus sequence USAGE for serial IDs.
 * Default privileges for objects created by `postgres` (typical migration role) ensure new tables
 * and sequences stay visible to PostgREST roles without manual GRANTs.
 *
 * Builds initial tenant Postgres bootstrap DDL (roles + API schema + grants).
 * `flux-system` uses {@link BOOTSTRAP_SQL} (`api`); new stacks may use `t_<shortId>_api`.
 */
export function buildBootstrapSql(apiSchemaName: string): string {
  assertFluxApiSchemaIdentifier(apiSchemaName);
  const q = `"${apiSchemaName.replace(/"/g, '""')}"`;
  return `
-- Schema that PostgREST will expose (default: first entry of PGRST_DB_SCHEMAS)
CREATE SCHEMA IF NOT EXISTS ${q};

-- Role that PostgREST connects as; cannot log in directly
DO $$ BEGIN
  CREATE ROLE authenticator NOINHERIT NOCREATEDB NOCREATEROLE NOSUPERUSER;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Roles that requests run as after JWT validation
DO $$ BEGIN
  CREATE ROLE anon NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE ROLE authenticated NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE ROLE service_role NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER ROLE service_role BYPASSRLS;

-- Allow authenticator to switch to request roles
GRANT anon          TO authenticator;
GRANT authenticated TO authenticator;
GRANT service_role   TO authenticator;

${FLUX_AUTH_SCHEMA_AND_UID_SQL}

${buildApiSchemaPrivilegesSql(apiSchemaName)}
`.trim();
}

/** Default bootstrap for legacy {@link LEGACY_FLUX_API_SCHEMA} (incl. flux-system). */
export const BOOTSTRAP_SQL = buildBootstrapSql(LEGACY_FLUX_API_SCHEMA);

/** PostgREST `PGRST_DB_SCHEMAS` value: primary API schema + public. */
export function pgrstDbSchemasEnvValue(apiSchemaName: string): string {
  assertFluxApiSchemaIdentifier(apiSchemaName);
  return `${apiSchemaName},public`;
}

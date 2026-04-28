/**
 * @flux/engine-v2 — Shared-cluster execution strategy.
 *
 * This package only provisions Postgres-side tenant isolation on the shared cluster.
 * JWT issuance remains in gateway.
 */
import pg from "pg";
import { deriveShortId } from "@flux/core/standalone";

const { Client } = pg;

const DEFAULT_AUTHENTICATOR_ROLE = "authenticator";
const DEFAULT_CONNECTION_LIMIT = 25;
const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;

export type ProvisionProjectInput = {
  tenantId: string;
};

export type ProvisionProjectResult = {
  tenantId: string;
  shortId: string;
  schema: string;
  role: string;
};

type TenantIdentity = {
  shortId: string;
  schema: string;
  role: string;
};

function quoteIdent(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function requireSharedPostgresUrl(): string {
  const value = process.env.FLUX_SHARED_POSTGRES_URL?.trim();
  if (!value) {
    throw new Error("FLUX_SHARED_POSTGRES_URL is required for v2 shared provisioning.");
  }
  return value;
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer when set.`);
  }
  return value;
}

export function deriveTenantIdentity(tenantId: string): TenantIdentity {
  const shortId = deriveShortId(tenantId);
  if (!/^[a-f0-9]{12}$/.test(shortId)) {
    throw new Error(
      `Derived shortId "${shortId}" is invalid for tenant "${tenantId}". Expected 12 lowercase hex chars.`,
    );
  }

  return {
    shortId,
    schema: `t_${shortId}_api`,
    role: `t_${shortId}_role`,
  };
}

export function buildTenantBootstrapSql(identity: TenantIdentity): string {
  const schema = quoteIdent(identity.schema);
  const role = quoteIdent(identity.role);
  const roleLiteral = identity.role.replaceAll("'", "''");
  const authenticator = quoteIdent(DEFAULT_AUTHENTICATOR_ROLE);
  const connectionLimit = parsePositiveIntEnv(
    "FLUX_V2_ROLE_CONNECTION_LIMIT",
    DEFAULT_CONNECTION_LIMIT,
  );
  const statementTimeoutMs = parsePositiveIntEnv(
    "FLUX_V2_ROLE_STATEMENT_TIMEOUT_MS",
    DEFAULT_STATEMENT_TIMEOUT_MS,
  );

  // Note: search_path intentionally omits "public" — strict schema isolation.
  // Runtime enforcement is handled by the pre-request hook (flux_set_tenant_context),
  // which works correctly in PgBouncer transaction mode.  ALTER ROLE SET is a
  // defence-in-depth fallback for any direct (non-pooled) session connections only.
  //
  // Note: CREATE ROLE is non-transactional DDL in PostgreSQL and cannot be wrapped
  // in an explicit BEGIN/COMMIT block.  The IF NOT EXISTS guard makes each statement
  // individually idempotent; partial execution is recoverable via the repair route.
  return `
CREATE SCHEMA IF NOT EXISTS ${schema};
DO $flux$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${roleLiteral}'
  ) THEN
    CREATE ROLE ${role};
  END IF;
END
$flux$;
GRANT USAGE ON SCHEMA ${schema} TO ${role};
ALTER ROLE ${role} SET search_path = ${schema};
ALTER ROLE ${role} CONNECTION LIMIT ${String(connectionLimit)};
ALTER ROLE ${role} SET statement_timeout = '${String(statementTimeoutMs)}ms';
GRANT ${role} TO ${authenticator};
SELECT pg_notify('pgrst', 'reload config');
`.trim();
}

/**
 * SQL that installs the two PostgREST server-side hooks into the shared
 * cluster's public schema.  Must be executed once at cluster initialisation
 * (and is safe to re-run — all statements use CREATE OR REPLACE).
 *
 * flux_postgrest_config  — PostgREST pre-config hook.
 *   Dynamically builds the db-schemas list by querying pg_namespace for all
 *   tenant schemas matching the t_<shortid>_api pattern.  PostgREST calls
 *   this function on every "reload config" notification, so new tenants become
 *   visible without restarting the PostgREST container.
 *
 * flux_set_tenant_context — PostgREST pre-request hook.
 *   Reads the JWT role claim embedded by the gateway, derives the tenant
 *   schema name, and issues SET LOCAL search_path + SET LOCAL statement_timeout.
 *   Using SET LOCAL (transaction-scoped) is the only correct approach in
 *   PgBouncer transaction-pooling mode — ALTER ROLE SET GUCs are only applied
 *   at session establishment, not when SET ROLE is called mid-session.
 */
export function buildClusterBootstrapSql(statementTimeoutMs: number): string {
  return `
CREATE OR REPLACE FUNCTION public.flux_postgrest_config()
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT set_config(
    'pgrst.db_schemas',
    coalesce(
      (
        SELECT string_agg(nspname, ',' ORDER BY nspname)
        FROM   pg_catalog.pg_namespace
        WHERE  nspname ~ '^t_[0-9a-f]{12}_api$'
      ),
      'public'
    ),
    true
  );
$$;

CREATE OR REPLACE FUNCTION public.flux_set_tenant_context()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  _claims  json;
  _role    text;
  _schema  text;
BEGIN
  BEGIN
    _claims := current_setting('request.jwt.claims', true)::json;
  EXCEPTION WHEN others THEN
    RETURN;
  END;

  _role := _claims->>'role';
  IF _role IS NULL OR _role NOT LIKE 't_%_role' THEN
    RETURN;
  END IF;

  -- Derive schema from role name: t_<shortid>_role -> t_<shortid>_api
  _schema := substring(_role FROM '^t_[0-9a-f]{12}') || '_api';

  -- SET LOCAL is transaction-scoped and works correctly in PgBouncer
  -- transaction-pooling mode (unlike ALTER ROLE SET, which is session-only).
  EXECUTE format('SET LOCAL search_path = %I', _schema);
  EXECUTE format('SET LOCAL statement_timeout = %L', '${String(statementTimeoutMs)}ms');
END;
$$;
`.trim();
}

export async function executeBootstrapSql(sql: string): Promise<void> {
  const client = new Client({
    connectionString: requireSharedPostgresUrl(),
  });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

/**
 * One-time cluster initialisation.  Creates the PostgREST pre-config and
 * pre-request hooks in the shared cluster's public schema.  Idempotent —
 * uses CREATE OR REPLACE, safe to re-run on every deploy.
 *
 * Must be called before PostgREST starts (or PostgREST must be signalled to
 * reload config immediately after).  The deploy script handles this ordering.
 */
export async function bootstrapSharedCluster(): Promise<void> {
  const statementTimeoutMs = parsePositiveIntEnv(
    "FLUX_V2_ROLE_STATEMENT_TIMEOUT_MS",
    DEFAULT_STATEMENT_TIMEOUT_MS,
  );
  const sql = buildClusterBootstrapSql(statementTimeoutMs);
  try {
    await executeBootstrapSql(sql);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to bootstrap shared cluster hooks: ${message}`);
  }
}

/**
 * Removes all PostgreSQL resources created for a tenant by provisionProject.
 * Intended for the rollback path when a higher-level transaction (e.g. the
 * Dashboard catalog insert) fails after provisioning has already succeeded.
 *
 * DROP SCHEMA ... CASCADE removes all objects (tables, views, functions, …)
 * owned by or inside the schema — this is irreversible data loss by design.
 * Never call this on a live project; only on a just-provisioned tenant whose
 * catalog row failed to commit.
 */
export async function deprovisionProject(tenantId: string): Promise<void> {
  const identity = deriveTenantIdentity(tenantId);
  const schema = quoteIdent(identity.schema);
  const role = quoteIdent(identity.role);
  const roleLiteral = identity.role.replaceAll("'", "''");

  const sql = `
DROP SCHEMA IF EXISTS ${schema} CASCADE;
DO $flux_drop$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${roleLiteral}'
  ) THEN
    DROP ROLE ${role};
  END IF;
END
$flux_drop$;
`.trim();

  try {
    await executeBootstrapSql(sql);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to deprovision shared tenant "${tenantId}" (shortId "${identity.shortId}"): ${message}`,
    );
  }
}

export async function provisionProject(
  input: ProvisionProjectInput,
): Promise<ProvisionProjectResult> {
  const identity = deriveTenantIdentity(input.tenantId);
  const sql = buildTenantBootstrapSql(identity);
  try {
    await executeBootstrapSql(sql);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed provisioning shared tenant bootstrap for tenant "${input.tenantId}" (shortId "${identity.shortId}"): ${message}`,
    );
  }
  return {
    tenantId: input.tenantId,
    shortId: identity.shortId,
    schema: identity.schema,
    role: identity.role,
  };
}

export class EngineV2 {
  async bootstrapSharedCluster(): Promise<void> {
    return bootstrapSharedCluster();
  }

  async provisionProject(input: ProvisionProjectInput): Promise<ProvisionProjectResult> {
    return provisionProject(input);
  }

  async deprovisionProject(tenantId: string): Promise<void> {
    return deprovisionProject(tenantId);
  }
}

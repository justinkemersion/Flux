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
const DEFAULT_ROLE_DATABASE_NAME = "postgres";

/**
 * Thrown by provisionProject when two different tenant UUIDs hash to the same
 * 12-hex shortId — an astronomically unlikely but fatal naming collision.
 * The caller must NOT attempt a retry with the same tenantId; the tenant UUID
 * itself must be re-generated.
 */
export class TenantShortIdCollisionError extends Error {
  readonly shortId: string;
  readonly requestedTenantId: string;
  readonly existingTenantId: string;

  constructor(shortId: string, requestedTenantId: string, existingTenantId: string) {
    super(
      `ShortId collision: schema "t_${shortId}_api" is already owned by tenant ` +
      `"${existingTenantId}", but provisioning was requested for a different tenant ` +
      `"${requestedTenantId}". The two UUIDs share the same 12-hex prefix. ` +
      `Re-generate the project UUID to obtain a fresh shortId.`,
    );
    this.name = "TenantShortIdCollisionError";
    this.shortId = shortId;
    this.requestedTenantId = requestedTenantId;
    this.existingTenantId = existingTenantId;
  }
}

export type ProvisionProjectInput = {
  tenantId: string;
};

export type ProvisionProjectResult = {
  tenantId: string;
  shortId: string;
  schema: string;
  role: string;
};

export type TenantIdentity = {
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

export function buildTenantBootstrapSql(
  identity: TenantIdentity,
  tenantId: string,
): string {
  const schema = quoteIdent(identity.schema);
  const role = quoteIdent(identity.role);
  const roleLiteral = identity.role.replaceAll("'", "''");
  const authenticator = quoteIdent(DEFAULT_AUTHENTICATOR_ROLE);
  const anon = quoteIdent("anon");
  const connectionLimit = parsePositiveIntEnv(
    "FLUX_V2_ROLE_CONNECTION_LIMIT",
    DEFAULT_CONNECTION_LIMIT,
  );
  const statementTimeoutMs = parsePositiveIntEnv(
    "FLUX_V2_ROLE_STATEMENT_TIMEOUT_MS",
    DEFAULT_STATEMENT_TIMEOUT_MS,
  );
  const roleDatabaseName =
    process.env.FLUX_V2_ROLE_DATABASE_NAME?.trim() || DEFAULT_ROLE_DATABASE_NAME;
  const roleDatabase = quoteIdent(roleDatabaseName);
  // Store tenantId on the schema as an ownership marker.  Used by
  // checkTenantOwnership to detect fatal shortId collisions between tenants.
  // UUIDs contain only [0-9a-f-] so single-quote escaping is purely defensive.
  const tenantIdLiteral = tenantId.replaceAll("'", "''");

  // search_path intentionally omits "public" — strict schema isolation.
  // Runtime enforcement via flux_set_tenant_context (pre-request hook) which
  // uses SET LOCAL and works correctly in PgBouncer transaction-pooling mode.
  // ALTER ROLE SET is a defence-in-depth fallback for direct session connections.
  //
  // CREATE ROLE is non-transactional DDL; the IF NOT EXISTS DO block makes
  // role creation individually idempotent without requiring a transaction wrapper.
  //
  // IMPORTANT: this SQL assumes the cluster-level `authenticator` role already
  // exists. That global role is created/managed by bin/deploy-v2-shared.sh in
  // the "--- v2 Shared Deploy: Global Database Bootstrap ---" section.
  //
  // The ALTER ROLE + GRANT statements below are intentionally OUTSIDE the
  // IF NOT EXISTS block: they are unconditional re-applications that act as
  // idempotent guardrails on every repair run, resetting CONNECTION LIMIT and
  // statement_timeout to their current configured values even when the role
  // already exists.
  return `
CREATE SCHEMA IF NOT EXISTS ${schema};
COMMENT ON SCHEMA ${schema} IS 'tenant:${tenantIdLiteral}';
DO $flux$
BEGIN
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${roleLiteral}'
    ) THEN
      CREATE ROLE ${role};
    END IF;
  EXCEPTION
    WHEN duplicate_object THEN
      -- Concurrent repair/provision attempts may race role creation.
      NULL;
  END;
END
$flux$;
GRANT USAGE ON SCHEMA ${schema} TO ${role};
-- Pool PostgREST roles need schema access: anon (unauthenticated) and
-- authenticator (login role that may SET ROLE before a tenant context).
GRANT USAGE ON SCHEMA ${schema} TO ${anon};
GRANT USAGE ON SCHEMA ${schema} TO ${authenticator};
-- Guest/public read: future tables in this schema grant SELECT to anon
-- (and existing tables via the ALL TABLES GRANTs below on each repair run).
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT SELECT ON TABLES TO ${anon};
-- Tenant app role: explicit table SELECT so RLS / policy checks work as
-- the PostgREST session role, including for "public" read-style policies.
GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${role};
GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${anon};
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT SELECT ON TABLES TO ${role};
ALTER ROLE ${role} SET search_path = ${schema};
ALTER ROLE ${role} CONNECTION LIMIT ${String(connectionLimit)};
ALTER ROLE ${role} IN DATABASE ${roleDatabase} SET statement_timeout = '${String(statementTimeoutMs)}ms';
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

/**
 * Opens a short-lived pg.Client, runs one parameterised query, and closes.
 * Used for read-only pre-flight checks that must not share a connection with
 * the DDL execution path (avoids implicit transaction state leakage).
 */
async function querySharedPostgres<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const client = new Client({ connectionString: requireSharedPostgresUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<T>(sql, params);
    return rows;
  } finally {
    await client.end();
  }
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
 * Runs DDL in a single transaction (BEGIN … COMMIT). Used for deprovision so
 * DROP SCHEMA + DROP ROLE stay atomic; safe to retry after ROLLBACK.
 */
async function executeTransactionalSql(sql: string): Promise<void> {
  const client = new Client({
    connectionString: requireSharedPostgresUrl(),
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    throw err;
  } finally {
    await client.end();
  }
}

/**
 * Pre-flight ownership check for provisionProject.
 *
 * Reads the COMMENT stored on the schema (if it already exists) and compares
 * it against the requesting tenant's ID.  Throws TenantShortIdCollisionError
 * when the schema exists and is owned by a DIFFERENT tenant.
 *
 * Note on TOCTOU: the collision probability between two distinct UUIDs sharing
 * the same 12-hex prefix is ~1/2^48 — negligible.  The check guards against
 * programming errors (stale state, double-provision), not concurrent races.
 */
export async function checkTenantOwnership(
  tenantId: string,
  identity: { shortId: string; schema: string },
): Promise<void> {
  const rows = await querySharedPostgres<{ tenant_comment: string | null }>(
    `SELECT obj_description(oid, 'pg_namespace') AS tenant_comment
     FROM   pg_catalog.pg_namespace
     WHERE  nspname = $1`,
    [identity.schema],
  );

  if (rows.length === 0) return; // schema doesn't exist yet — fresh provision

  const raw = rows[0]!.tenant_comment ?? "";
  if (!raw.startsWith("tenant:")) return; // no ownership marker — treat as ours (legacy)

  const existingTenantId = raw.slice("tenant:".length);
  if (existingTenantId !== tenantId) {
    throw new TenantShortIdCollisionError(identity.shortId, tenantId, existingTenantId);
  }
  // Same tenant ID — idempotent re-provision or repair; proceed normally.
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
 * Pure SQL for `deprovisionProject` — DROP SCHEMA CASCADE + guarded DROP ROLE.
 * Exposed for unit tests and operator review without opening a DB connection.
 *
 * `deprovisionProject` removes all PostgreSQL resources created for a tenant.
 * Intended for rollback when the catalog insert fails after provisioning.
 * DROP SCHEMA … CASCADE is irreversible; idempotent for DROP IF EXISTS + guarded DROP ROLE.
 */
export function buildDeprovisionSql(identity: TenantIdentity): string {
  const schema = quoteIdent(identity.schema);
  const role = quoteIdent(identity.role);
  const roleLiteral = identity.role.replaceAll("'", "''");

  return `
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
}

/** Executes {@link buildDeprovisionSql} against the shared cluster (transactional). */
export async function deprovisionProject(tenantId: string): Promise<void> {
  const identity = deriveTenantIdentity(tenantId);
  const sql = buildDeprovisionSql(identity);

  try {
    await executeTransactionalSql(sql);
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

  // Pre-flight: detect fatal shortId collisions before running any DDL.
  // Throws TenantShortIdCollisionError when the schema exists but is owned
  // by a different tenant UUID — caller must not retry with the same tenantId.
  await checkTenantOwnership(input.tenantId, identity);

  const sql = buildTenantBootstrapSql(identity, input.tenantId);
  try {
    await executeBootstrapSql(sql);
  } catch (error: unknown) {
    if (error instanceof TenantShortIdCollisionError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const roleMissing =
      /role\s+"?authenticator"?\s+does\s+not\s+exist/i.test(message) ||
      /role\s+"?anon"?\s+does\s+not\s+exist/i.test(message) ||
      /role\s+".*"\s+does\s+not\s+exist/i.test(message);
    const bootstrapHint = roleMissing
      ? " Hint: run ./bin/deploy-v2-shared.sh and confirm the 'Global Database Bootstrap' step completed (authenticator/anon roles)."
      : "";
    throw new Error(
      `Failed provisioning shared tenant bootstrap for tenant "${input.tenantId}" (shortId "${identity.shortId}"): ${message}${bootstrapHint}`,
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

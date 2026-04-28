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
ALTER ROLE ${role} SET search_path = ${schema}, public;
ALTER ROLE ${role} CONNECTION LIMIT ${String(connectionLimit)};
ALTER ROLE ${role} SET statement_timeout = '${String(statementTimeoutMs)}ms';
GRANT ${role} TO ${authenticator};
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
  async provisionProject(input: ProvisionProjectInput): Promise<ProvisionProjectResult> {
    return provisionProject(input);
  }
}

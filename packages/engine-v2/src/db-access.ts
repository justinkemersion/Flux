/**
 * Temporary project-scoped PostgreSQL roles for v2 private database access.
 * Never uses pooled admin credentials; grants are schema-scoped only.
 */
import {
  defaultTenantRoleFromProjectId,
  fluxTempLoginRoleName,
  fluxTenantGroupRoleName,
  quotePgIdent,
  sanitizeDbAccessHashSegment,
  type DbAccessLevel,
} from "@flux/core";
import pg from "pg";

const { Client } = pg;

function requireSharedPostgresUrl(): string {
  const value = process.env.FLUX_SHARED_POSTGRES_URL?.trim();
  if (!value) {
    throw new Error("FLUX_SHARED_POSTGRES_URL is required for v2 db access roles.");
  }
  return value;
}

async function executeDbAccessSql(sql: string): Promise<void> {
  const client = new Client({ connectionString: requireSharedPostgresUrl() });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

export type DbAccessRoleContext = {
  projectHash: string;
  projectId: string;
  tenantSchema: string;
  access: DbAccessLevel;
};

export function buildEnsureTenantDbAccessGroupRoleSql(
  ctx: DbAccessRoleContext,
): string {
  const tenantRole = defaultTenantRoleFromProjectId(ctx.projectId);
  const schema = quotePgIdent(ctx.tenantSchema);
  const tenantRoleIdent = quotePgIdent(tenantRole);
  const groupName = fluxTenantGroupRoleName(ctx.projectHash, ctx.access);
  const groupRole = quotePgIdent(groupName);
  const groupLiteral = groupName.replaceAll("'", "''");

  const tableGrants =
    ctx.access === "readonly"
      ? `GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${groupRole};
ALTER DEFAULT PRIVILEGES FOR ROLE ${tenantRoleIdent} IN SCHEMA ${schema}
  GRANT SELECT ON TABLES TO ${groupRole};`
      : `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${groupRole};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${groupRole};
ALTER DEFAULT PRIVILEGES FOR ROLE ${tenantRoleIdent} IN SCHEMA ${schema}
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${groupRole};
ALTER DEFAULT PRIVILEGES FOR ROLE ${tenantRoleIdent} IN SCHEMA ${schema}
  GRANT USAGE, SELECT ON SEQUENCES TO ${groupRole};`;

  return `
DO $flux$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${groupLiteral}'
  ) THEN
    CREATE ROLE ${groupRole} NOLOGIN;
  END IF;
END
$flux$;
GRANT USAGE ON SCHEMA ${schema} TO ${groupRole};
${tableGrants}
`.trim();
}

export function buildCreateTempDbAccessLoginRoleSql(input: {
  projectHash: string;
  access: DbAccessLevel;
  suffix: string;
  password: string;
  expiresAt: Date;
  tenantSchema: string;
}): string {
  const groupRole = quotePgIdent(
    fluxTenantGroupRoleName(input.projectHash, input.access),
  );
  const loginName = fluxTempLoginRoleName(
    input.projectHash,
    input.access,
    input.suffix,
  );
  const loginRole = quotePgIdent(loginName);
  const schema = quotePgIdent(input.tenantSchema);
  const passwordLiteral = input.password.replaceAll("'", "''");
  const validUntil = input.expiresAt.toISOString().replaceAll("'", "''");

  return `
CREATE ROLE ${loginRole} LOGIN PASSWORD '${passwordLiteral}' VALID UNTIL '${validUntil}';
GRANT ${groupRole} TO ${loginRole};
ALTER ROLE ${loginRole} SET search_path = ${schema}, public;
`.trim();
}

export function buildCleanupExpiredTempDbAccessRolesSql(projectHash?: string): string {
  const hashPattern = projectHash
    ? sanitizeDbAccessHashSegment(projectHash)
    : "[a-f0-9]{7}";
  const rolePattern = `'^flux_temp_(ro|rw)_${hashPattern}_[a-f0-9]{8}$'`;

  return `
DO $flux$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT rolname FROM pg_catalog.pg_roles
    WHERE rolcanlogin
      AND rolname ~ ${rolePattern}
      AND rolvaliduntil IS NOT NULL
      AND rolvaliduntil < NOW()
  LOOP
    EXECUTE format('DROP ROLE IF EXISTS %I', r.rolname);
  END LOOP;
END
$flux$;
`.trim();
}

export async function provisionTemporaryDbAccessCredential(input: {
  projectHash: string;
  projectId: string;
  tenantSchema: string;
  access: DbAccessLevel;
  password: string;
  suffix: string;
  expiresAt: Date;
}): Promise<{ username: string }> {
  const ctx: DbAccessRoleContext = {
    projectHash: input.projectHash,
    projectId: input.projectId,
    tenantSchema: input.tenantSchema,
    access: input.access,
  };
  const username = fluxTempLoginRoleName(
    input.projectHash,
    input.access,
    input.suffix,
  );

  await executeDbAccessSql(buildCleanupExpiredTempDbAccessRolesSql(input.projectHash));
  await executeDbAccessSql(buildEnsureTenantDbAccessGroupRoleSql(ctx));
  await executeDbAccessSql(
    buildCreateTempDbAccessLoginRoleSql({
      projectHash: input.projectHash,
      access: input.access,
      suffix: input.suffix,
      password: input.password,
      expiresAt: input.expiresAt,
      tenantSchema: input.tenantSchema,
    }),
  );

  return { username };
}

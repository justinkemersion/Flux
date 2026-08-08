import {
  buildAssertRuntimeRoleOwnsNothingSql,
  buildForceRlsInvariantSql,
} from "@flux/core/tenant-rls-invariants";
import type { PushPgClient } from "@/src/lib/pooled-push";
import { quoteIdent } from "@/src/lib/pooled-push";

export const TENANT_ROLE_NAME_RE = /^t_[0-9a-f]{12}_role$/u;
export const TENANT_DDL_ROLE_NAME_RE = /^t_[0-9a-f]{12}_ddl$/u;
export const TENANT_SCHEMA_NAME_RE = /^t_[0-9a-f]{12}_api$/u;

const PRIVILEGE_ESCAPE_RE =
  /\b(?:SET\s+(?:LOCAL\s+)?(?:ROLE|SESSION\s+AUTHORIZATION)|RESET\s+ROLE)\b/i;

export function assertTenantRoleName(role: string): void {
  if (!TENANT_ROLE_NAME_RE.test(role)) {
    throw new Error("Refusing push: tenant role name is malformed");
  }
}

/**
 * The DDL role owns tenant objects and must never be the runtime PostgREST role;
 * see `@flux/core/tenant-rls-invariants`.
 */
export function assertTenantDdlRoleName(ddlRole: string): void {
  if (!TENANT_DDL_ROLE_NAME_RE.test(ddlRole)) {
    throw new Error("Refusing push: tenant DDL role name is malformed");
  }
}

export function assertTenantSchemaName(schema: string): void {
  if (!TENANT_SCHEMA_NAME_RE.test(schema)) {
    throw new Error("Refusing push: tenant schema name is malformed");
  }
}

/** Reject obvious attempts to escalate DB privileges inside tenant push SQL. */
export function rejectPooledPushPrivilegeEscape(sql: string): void {
  if (PRIVILEGE_ESCAPE_RE.test(sql)) {
    throw new Error("SQL contains disallowed privilege escalation statements");
  }
}

export async function beginPooledPushTransaction(client: PushPgClient): Promise<void> {
  await client.query("BEGIN");
  await client.query("SET LOCAL statement_timeout = '30s'");
}

/**
 * Enters the tenant DDL context: pushed SQL runs as the per-tenant owner role with the
 * tenant schema on the search path, never as the control plane and never as the runtime
 * PostgREST role.
 */
export async function setPooledPushTenantContext(
  client: PushPgClient,
  input: { schema: string; ddlRole: string },
): Promise<void> {
  assertTenantSchemaName(input.schema);
  assertTenantDdlRoleName(input.ddlRole);
  await client.query(`SET LOCAL ROLE ${quoteIdent(input.ddlRole)}`);
  await client.query(`SET LOCAL search_path TO ${quoteIdent(input.schema)}`);
}

export async function resetPooledPushRole(client: PushPgClient): Promise<void> {
  await client.query("RESET ROLE");
}

/**
 * Runs after `RESET ROLE`, as the control plane, so the sweep can touch tables the DDL
 * role does not own (pre-Pass-6b objects still owned by the bootstrap role).
 */
export async function enforcePooledPushRlsInvariants(
  client: PushPgClient,
  input: { schema: string; runtimeRole: string },
): Promise<void> {
  assertTenantSchemaName(input.schema);
  assertTenantRoleName(input.runtimeRole);
  await client.query(buildForceRlsInvariantSql(input.schema));
  await client.query(
    buildAssertRuntimeRoleOwnsNothingSql(input.schema, input.runtimeRole),
  );
}

export async function finishPooledPushTransaction(client: PushPgClient): Promise<void> {
  await client.query("NOTIFY pgrst, 'reload schema';");
  await client.query("COMMIT");
}

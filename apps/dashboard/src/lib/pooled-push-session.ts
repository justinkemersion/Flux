import type { PushPgClient } from "@/src/lib/pooled-push";
import { quoteIdent } from "@/src/lib/pooled-push";

export const TENANT_ROLE_NAME_RE = /^t_[0-9a-f]{12}_role$/u;
export const TENANT_SCHEMA_NAME_RE = /^t_[0-9a-f]{12}_api$/u;

const PRIVILEGE_ESCAPE_RE =
  /\b(?:SET\s+(?:LOCAL\s+)?(?:ROLE|SESSION\s+AUTHORIZATION)|RESET\s+ROLE)\b/i;

export function assertTenantRoleName(role: string): void {
  if (!TENANT_ROLE_NAME_RE.test(role)) {
    throw new Error("Refusing push: tenant role name is malformed");
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

export async function setPooledPushTenantContext(
  client: PushPgClient,
  input: { schema: string; role: string },
): Promise<void> {
  assertTenantSchemaName(input.schema);
  assertTenantRoleName(input.role);
  await client.query(`SET LOCAL ROLE ${quoteIdent(input.role)}`);
  await client.query(`SET LOCAL search_path TO ${quoteIdent(input.schema)}`);
}

export async function resetPooledPushRole(client: PushPgClient): Promise<void> {
  await client.query("RESET ROLE");
}

export async function finishPooledPushTransaction(client: PushPgClient): Promise<void> {
  await client.query("NOTIFY pgrst, 'reload schema';");
  await client.query("COMMIT");
}

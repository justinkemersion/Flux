import {
  assertFluxApiSchemaIdentifier,
  defaultTenantRoleFromProjectId,
} from "./api-schema-strategy.ts";

/** v2_shared pooled push: transaction-scoped search_path prefix (tenant schema first). */
export const POOLED_PUSH_SEARCH_PATH_SUFFIX = "public" as const;

export type PooledPushSqlAdaptInput = {
  tenantSchema: string;
  tenantRole: string;
};

function quoteIdent(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

/**
 * Rewrites Supabase / Foundry-style privilege SQL for v2_shared pooled push.
 *
 * Execution context (see {@link POOLED_PUSH_SEARCH_PATH_SUFFIX}):
 * - `SET LOCAL search_path TO t_<shortId>_api, public` — unqualified DDL/DML resolves in the tenant schema first.
 * - The shared cluster has `anon` / `authenticator` but not a global `authenticated` role; runtime JWTs use `t_<shortId>_role`.
 *
 * Rewrites (idempotent for already-adapted SQL):
 * - `GRANT|REVOKE ... ON SCHEMA public` → tenant API schema
 * - `authenticated` role in GRANT/REVOKE/ALTER DEFAULT PRIVILEGES/CREATE POLICY → tenant role
 *
 * Checksums and ledger rows remain on pre-adapt normalized file content; adaptation runs at execution only.
 */
export function adaptPooledPushSql(
  sql: string,
  input: PooledPushSqlAdaptInput,
): string {
  assertFluxApiSchemaIdentifier(input.tenantSchema);
  assertFluxApiSchemaIdentifier(input.tenantRole.replace(/_role$/, "_api"));
  const quotedSchema = quoteIdent(input.tenantSchema);
  const quotedRole = quoteIdent(input.tenantRole);

  let out = sql;

  out = out.replace(
    /\b(GRANT|REVOKE)\b([^;]*?\bON\s+SCHEMA\s+)public\b/gi,
    (_match, grantRevoke: string, middle: string) =>
      `${grantRevoke}${middle}${quotedSchema}`,
  );

  out = out.replace(
    /\b(ALTER\s+DEFAULT\s+PRIVILEGES)\b([^;]*?\bIN\s+SCHEMA\s+)public\b/gi,
    (_match, alter: string, middle: string) => `${alter}${middle}${quotedSchema}`,
  );

  const privilegeStatement =
    /\b(GRANT|REVOKE|ALTER\s+DEFAULT\s+PRIVILEGES|CREATE\s+POLICY)\b[^;]*/gi;
  out = out.replace(privilegeStatement, (statement) =>
    statement.replace(/\bauthenticated\b/gi, quotedRole),
  );

  return out;
}

/** Derives tenant role from catalog project UUID (same as gateway bridge JWT). */
export function pooledPushTenantRoleFromProjectId(projectId: string): string {
  return defaultTenantRoleFromProjectId(projectId);
}

/** Builds the `SET LOCAL search_path` list for pooled push transactions. */
export function pooledPushSearchPathList(tenantSchema: string): string {
  assertFluxApiSchemaIdentifier(tenantSchema);
  return `${quoteIdent(tenantSchema)}, ${POOLED_PUSH_SEARCH_PATH_SUFFIX}`;
}

import { assertFluxApiSchemaIdentifier } from "./api-schema-strategy.ts";

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
 * Execution context:
 * - `SET LOCAL ROLE t_<shortId>_role` — user SQL runs as the tenant role, never the control plane role.
 * - `SET LOCAL search_path TO t_<shortId>_api` — unqualified DDL/DML resolves in the tenant schema.
 * - The shared cluster has `anon` / `authenticator` but not a global `authenticated` role; runtime JWTs use `t_<shortId>_role`.
 *
 * Rewrites (idempotent for already-adapted SQL):
 * - `GRANT|REVOKE ... ON SCHEMA public` → tenant API schema
 * - `authenticated` role in GRANT/REVOKE/ALTER DEFAULT PRIVILEGES/CREATE POLICY → tenant role
 *
 * Deliberately does **not** rewrite qualified `public.<object>` references: on the shared
 * cluster `public` holds the PostgREST hook functions and any operator-installed extensions,
 * so blanket reschemaing would break references to objects that legitimately live there.
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

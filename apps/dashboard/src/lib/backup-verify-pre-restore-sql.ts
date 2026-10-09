import {
  collectRestoreRoleNames,
  defaultTenantDdlRoleFromProjectId,
  defaultTenantRoleFromProjectId,
  FLUX_AUTH_SCHEMA_AND_UID_SQL,
  buildRestoreRoleStubSql,
} from "@flux/core";

export type BackupVerifyPreRestoreKind = "project_db" | "tenant_export";

const PLATFORM_ROLE_STUBS = new Set([
  "anon",
  "authenticated",
  "service_role",
  "authenticator",
]);

/**
 * Idempotent roles required before `pg_restore` in the disposable Postgres used by
 * `flux backup verify`.
 *
 * Custom-format archives keep `CREATE POLICY ... TO <role>` (`--no-acl` does not
 * strip policies) and `ALTER ... OWNER TO <role>` (suppressed only when restore
 * passes `--no-owner`). v2 tenant exports name `t_<shortId>_role` and
 * `t_<shortId>_ddl`. Grants and default privileges are stubbed too when the
 * archive still contains them.
 *
 * Tenant stubs are NOLOGIN with no superuser and no BYPASSRLS. `service_role`
 * keeps BYPASSRLS so it matches dedicated bootstrap. The disposable database is
 * removed with the verify container, which drops the stubs.
 *
 * v2 tenant exports often use `DEFAULT auth.uid()` on columns; the disposable
 * verify DB has no `auth` schema until we create the Flux auth compat stub.
 */
export function buildBackupVerifyPreRestoreSql(input: {
  projectId: string;
  kind: BackupVerifyPreRestoreKind;
  /** `pg_restore --schema-only` text, or a plain SQL dump. */
  schemaSql?: string;
}): string {
  const tenantRole = defaultTenantRoleFromProjectId(input.projectId);
  const tenantDdlRole = defaultTenantDdlRoleFromProjectId(input.projectId);
  const known = new Set<string>([...PLATFORM_ROLE_STUBS, tenantRole, tenantDdlRole]);
  const extras = collectRestoreRoleNames(input.schemaSql ?? "", input.projectId).filter(
    (name) => !known.has(name),
  );
  const parts = [
    buildRestoreRoleStubSql(["anon", "authenticated", "authenticator"]),
    "DO $$ BEGIN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
    buildRestoreRoleStubSql([tenantRole, tenantDdlRole, ...extras]),
    "GRANT anon, authenticated, service_role TO authenticator;",
  ];
  if (input.kind === "tenant_export") {
    parts.push(FLUX_AUTH_SCHEMA_AND_UID_SQL);
  }
  return parts.filter((part) => part.trim().length > 0).join("\n");
}

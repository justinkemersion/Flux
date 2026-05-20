import { defaultTenantRoleFromProjectId } from "@flux/core";

export type BackupVerifyPreRestoreKind = "project_db" | "tenant_export";

function createRoleStmt(roleName: string): string {
  return `DO $$ BEGIN CREATE ROLE ${roleName} NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`;
}

/**
 * Idempotent roles required before `pg_restore` in the disposable Postgres used by
 * `flux backup verify`.
 *
 * `pg_dump --no-acl` strips GRANT but keeps `CREATE POLICY ... TO <role>`. v2 tenant
 * exports reference `t_<shortId>_role`; v1 / legacy dumps may reference `authenticated`.
 */
export function buildBackupVerifyPreRestoreSql(input: {
  projectId: string;
  kind: BackupVerifyPreRestoreKind;
}): string {
  const tenantRole = defaultTenantRoleFromProjectId(input.projectId);
  return [
    createRoleStmt("anon"),
    createRoleStmt("authenticated"),
    "DO $$ BEGIN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
    createRoleStmt("authenticator"),
    createRoleStmt(tenantRole),
    "GRANT anon, authenticated, service_role TO authenticator;",
  ].join(" ");
}

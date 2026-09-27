import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIdempotentNologinRoleSql,
  buildRestoreRoleStubSql,
  collectRestoreRoleNames,
  extractRestoreRoleDependencies,
  pgRestoreRejectedReason,
} from "./backup-restore-roles.ts";

const FIXTURE = `
-- Name: organization_members organization_members_definer_select; Type: POLICY; Schema: t_fc8d36eae5ad_api; Owner: t_fc8d36eae5ad_ddl
-- GRANT SELECT TO buried_in_comment;

CREATE SCHEMA t_fc8d36eae5ad_api;
ALTER SCHEMA t_fc8d36eae5ad_api OWNER TO t_fc8d36eae5ad_ddl;

CREATE FUNCTION t_fc8d36eae5ad_api.definer_count() RETURNS integer
    LANGUAGE sql SECURITY DEFINER
    AS $$ GRANT SELECT TO buried_in_body; SELECT 1 $$;
ALTER FUNCTION t_fc8d36eae5ad_api.definer_count() OWNER TO t_fc8d36eae5ad_ddl;

ALTER TABLE t_fc8d36eae5ad_api.organization_members OWNER TO t_fc8d36eae5ad_ddl;

CREATE POLICY organization_members_definer_select ON t_fc8d36eae5ad_api.organization_members FOR SELECT TO t_fc8d36eae5ad_ddl USING (true);

GRANT USAGE ON SCHEMA t_fc8d36eae5ad_api TO t_fc8d36eae5ad_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE t_fc8d36eae5ad_api.organization_members TO t_fc8d36eae5ad_role;
GRANT t_fc8d36eae5ad_ddl TO postgres;

ALTER DEFAULT PRIVILEGES FOR ROLE t_fc8d36eae5ad_ddl IN SCHEMA t_fc8d36eae5ad_api GRANT SELECT ON TABLES TO t_fc8d36eae5ad_role;

COMMENT ON SCHEMA t_fc8d36eae5ad_api IS 'GRANT SELECT TO buried_in_string';
SET SESSION AUTHORIZATION t_fc8d36eae5ad_ddl;
`;

test("extractRestoreRoleDependencies keeps policy, owner, grant, and default-privilege roles", () => {
  const roles = extractRestoreRoleDependencies(FIXTURE);
  assert.deepEqual(roles.sort(), ["t_fc8d36eae5ad_ddl", "t_fc8d36eae5ad_role"]);
});

test("extractRestoreRoleDependencies ignores roles the dump creates itself", () => {
  const sql = `
    CREATE ROLE app_login LOGIN PASSWORD 'x';
    GRANT app_login TO postgres;
    CREATE POLICY p ON s.t FOR SELECT TO app_login, t_abc_ddl USING (true);
  `;
  assert.deepEqual(extractRestoreRoleDependencies(sql), ["t_abc_ddl"]);
});

test("collectRestoreRoleNames adds catalog tenant roles", () => {
  const names = collectRestoreRoleNames(
    "CREATE POLICY p ON s.t FOR SELECT TO other_reader USING (true);",
    "550e8400-e29b-41d4-a716-446655440000",
  );
  assert.deepEqual(names, [
    "other_reader",
    "t_550e8400e29b_role",
    "t_550e8400e29b_ddl",
  ]);
});

test("buildRestoreRoleStubSql is nologin and has no bypassrls", () => {
  const sql = buildRestoreRoleStubSql(["t_fc8d36eae5ad_ddl", "t_fc8d36eae5ad_ddl"]);
  assert.match(
    sql,
    /CREATE ROLE "t_fc8d36eae5ad_ddl" NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS/,
  );
  assert.doesNotMatch(sql, /\bBYPASSRLS\b/);
  assert.equal(sql.split("CREATE ROLE").length - 1, 1);
  assert.throws(() => buildIdempotentNologinRoleSql("postgres"), /Refusing to create/);
  assert.throws(() => buildIdempotentNologinRoleSql("pg_read_all_data"), /Refusing to create/);
});

test("pgRestoreRejectedReason fails closed on ignored errors", () => {
  const stderr = [
    'pg_restore: error: could not execute query: ERROR:  role "t_fc8d36eae5ad_ddl" does not exist',
    "Command was: CREATE POLICY organization_members_definer_select ON t_fc8d36eae5ad_api.organization_members FOR SELECT TO t_fc8d36eae5ad_ddl USING (true);",
    "pg_restore: warning: errors ignored on restore: 1",
  ].join("\n");
  const reason = pgRestoreRejectedReason(1, stderr);
  assert.ok(reason);
  assert.match(reason, /pg_restore failed \(1\)/);
  assert.match(reason, /errors ignored on restore: 1/);
  assert.equal(pgRestoreRejectedReason(0, ""), null);
  assert.equal(pgRestoreRejectedReason(0, "pg_restore: warning: errors ignored on restore: 0"), null);
  assert.match(pgRestoreRejectedReason(0, "pg_restore: warning: errors ignored on restore: 2") ?? "", /failed/);
});

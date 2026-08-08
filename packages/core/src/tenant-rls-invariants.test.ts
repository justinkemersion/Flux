import assert from "node:assert/strict";
import test from "node:test";
import { defaultTenantDdlRoleFromProjectId } from "./api-schema-strategy.ts";
import {
  buildAssertRuntimeRoleOwnsNothingSql,
  buildForceRlsInvariantSql,
  FORCE_RLS_EXEMPTION_MARKER,
} from "./tenant-rls-invariants.ts";

const SCHEMA = "t_aabbccddeeff_api";
const RUNTIME_ROLE = "t_aabbccddeeff_role";

test("the DDL role is derived from the same short id as the schema and runtime role", () => {
  const projectId = "aabbccdd-eeff-4a1b-8c2d-3e4f5a6b7c8d";
  assert.equal(defaultTenantDdlRoleFromProjectId(projectId), "t_aabbccddeeff_ddl");
});

test("forcing RLS is scoped to tables that already enabled it", () => {
  const sql = buildForceRlsInvariantSql(SCHEMA);
  assert.match(sql, /c\.relrowsecurity/);
  assert.match(sql, /NOT c\.relforcerowsecurity/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, new RegExp(FORCE_RLS_EXEMPTION_MARKER));
});

test("the ownership assertion names the runtime role and raises", () => {
  const sql = buildAssertRuntimeRoleOwnsNothingSql(SCHEMA, RUNTIME_ROLE);
  assert.match(sql, /RAISE EXCEPTION/);
  assert.match(sql, new RegExp(RUNTIME_ROLE));
  assert.match(sql, /pg_get_userbyid\(c\.relowner\)/);
});

test("invariant builders reject identifiers that are not canonical tenant names", () => {
  assert.throws(() => buildForceRlsInvariantSql("public"));
  assert.throws(() => buildForceRlsInvariantSql("t_aabbccddeeff_api; DROP SCHEMA x"));
  assert.throws(() => buildAssertRuntimeRoleOwnsNothingSql(SCHEMA, "postgres"));
  assert.throws(() =>
    buildAssertRuntimeRoleOwnsNothingSql(SCHEMA, "t_aabbccddeeff_role'; DROP ROLE x --"),
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  rewriteV2TenantPushSql,
  tenantRoleFromApiSchema,
} from "./v2-push-sql-rewrite.ts";

const SCHEMA = "t_aabbccddeeff_api";
const ROLE = "t_aabbccddeeff_role";

test("tenantRoleFromApiSchema derives role from tenant API schema", () => {
  assert.equal(tenantRoleFromApiSchema(SCHEMA), ROLE);
  assert.throws(
    () => tenantRoleFromApiSchema("api"),
    /expected t_<12hex>_api/u,
  );
});

test("rewriteV2TenantPushSql maps authenticated grants to tenant role", () => {
  const sql = `
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO authenticated;
CREATE POLICY p ON items FOR SELECT TO authenticated USING (true);
`.trim();

  const rewritten = rewriteV2TenantPushSql(sql, {
    tenantSchema: SCHEMA,
    tenantRole: ROLE,
  });

  assert.match(rewritten, /GRANT USAGE ON SCHEMA t_aabbccddeeff_api TO t_aabbccddeeff_role/u);
  assert.match(
    rewritten,
    /GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA t_aabbccddeeff_api TO t_aabbccddeeff_role/u,
  );
  assert.match(rewritten, /FOR SELECT TO t_aabbccddeeff_role/u);
  assert.doesNotMatch(rewritten, /\bauthenticated\b/u);
  assert.doesNotMatch(rewritten, /\bSCHEMA public\b/u);
});

test("rewriteV2TenantPushSql maps legacy api schema references", () => {
  const sql =
    "GRANT USAGE ON SCHEMA api TO authenticated;\nCREATE TABLE api.items (id int);";
  const rewritten = rewriteV2TenantPushSql(sql, {
    tenantSchema: SCHEMA,
    tenantRole: ROLE,
  });

  assert.match(rewritten, /GRANT USAGE ON SCHEMA t_aabbccddeeff_api TO t_aabbccddeeff_role/u);
  assert.match(rewritten, /CREATE TABLE t_aabbccddeeff_api.items/u);
});

test("rewriteV2TenantPushSql leaves string literals untouched", () => {
  const sql =
    "INSERT INTO notes (body) VALUES ('authenticated users only');";
  const rewritten = rewriteV2TenantPushSql(sql, {
    tenantSchema: SCHEMA,
    tenantRole: ROLE,
  });
  assert.equal(rewritten, sql);
});

test("rewriteV2TenantPushSql is idempotent for already-tenant-scoped SQL", () => {
  const sql = `GRANT SELECT ON ALL TABLES IN SCHEMA ${SCHEMA} TO ${ROLE};`;
  const rewritten = rewriteV2TenantPushSql(sql, {
    tenantSchema: SCHEMA,
    tenantRole: ROLE,
  });
  assert.equal(rewritten, sql);
});

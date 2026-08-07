import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptPooledPushSql,
  pooledPushSearchPathList,
  pooledPushTenantRoleFromProjectId,
} from "./pooled-push-sql-adapt.ts";

const SCHEMA = "t_5ecfa3ab72d1_api";
const ROLE = "t_5ecfa3ab72d1_role";
const ADAPT = { tenantSchema: SCHEMA, tenantRole: ROLE };

test("adaptPooledPushSql maps GRANT TO authenticated to tenant role", () => {
  const sql = `
CREATE TABLE profiles (id uuid PRIMARY KEY);
GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO authenticated;
`;
  const out = adaptPooledPushSql(sql, ADAPT);
  assert.match(out, /GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO "t_5ecfa3ab72d1_role"/);
  assert.doesNotMatch(out, /\bauthenticated\b/i);
});

test("adaptPooledPushSql maps GRANT ON SCHEMA public to tenant schema", () => {
  const sql = "GRANT USAGE ON SCHEMA public TO authenticated;";
  const out = adaptPooledPushSql(sql, ADAPT);
  assert.match(out, /GRANT USAGE ON SCHEMA "t_5ecfa3ab72d1_api" TO "t_5ecfa3ab72d1_role"/);
});

test("adaptPooledPushSql rewrites ALTER DEFAULT PRIVILEGES for authenticated", () => {
  const sql =
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;";
  const out = adaptPooledPushSql(sql, ADAPT);
  assert.match(out, /IN SCHEMA "t_5ecfa3ab72d1_api"/);
  assert.match(out, /TO "t_5ecfa3ab72d1_role"/);
});

test("adaptPooledPushSql rewrites CREATE POLICY TO authenticated", () => {
  const sql = `
CREATE POLICY profiles_self ON profiles
  FOR ALL TO authenticated
  USING (auth.uid() = user_id);
`;
  const out = adaptPooledPushSql(sql, ADAPT);
  assert.match(out, /FOR ALL TO "t_5ecfa3ab72d1_role"/);
});

test("adaptPooledPushSql preserves anon grants", () => {
  const sql = "GRANT SELECT ON profiles TO anon, authenticated;";
  const out = adaptPooledPushSql(sql, ADAPT);
  assert.match(out, /TO anon, "t_5ecfa3ab72d1_role"/);
});

test("adaptPooledPushSql leaves unqualified CREATE TABLE unchanged", () => {
  const sql = "CREATE TABLE IF NOT EXISTS profiles (id uuid PRIMARY KEY);";
  assert.equal(adaptPooledPushSql(sql, ADAPT), sql);
});

test("pooledPushSearchPathList quotes tenant schema and includes public", () => {
  assert.equal(
    pooledPushSearchPathList(SCHEMA),
    '"t_5ecfa3ab72d1_api", public',
  );
});

test("pooledPushTenantRoleFromProjectId matches schema short id", () => {
  assert.equal(
    pooledPushTenantRoleFromProjectId("5ecfa3ab-72d1-4b3a-9c8e-111111111111"),
    ROLE,
  );
});

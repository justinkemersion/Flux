import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCleanupExpiredTempDbAccessRolesSql,
  buildCreateTempDbAccessLoginRoleSql,
  buildEnsureTenantDbAccessGroupRoleSql,
} from "./db-access.ts";

const PROJECT_ID = "5ecfa3ab-72d1-4b3a-9c8e-111111111111";
const HASH = "ffca33f";
const SCHEMA = "t_5ecfa3ab72d1_api";

test("buildEnsureTenantDbAccessGroupRoleSql grants readonly on tenant schema", () => {
  const sql = buildEnsureTenantDbAccessGroupRoleSql({
    projectHash: HASH,
    projectId: PROJECT_ID,
    tenantSchema: SCHEMA,
    access: "readonly",
  });
  assert.match(sql, /CREATE ROLE "flux_tenant_ffca33f_ro" NOLOGIN/);
  assert.match(sql, /GRANT USAGE ON SCHEMA "t_5ecfa3ab72d1_api" TO "flux_tenant_ffca33f_ro"/);
  assert.match(sql, /GRANT SELECT ON ALL TABLES IN SCHEMA "t_5ecfa3ab72d1_api"/);
  assert.match(
    sql,
    /ALTER DEFAULT PRIVILEGES FOR ROLE "t_5ecfa3ab72d1_role" IN SCHEMA "t_5ecfa3ab72d1_api"/,
  );
});

test("buildEnsureTenantDbAccessGroupRoleSql grants readwrite DML on tenant schema", () => {
  const sql = buildEnsureTenantDbAccessGroupRoleSql({
    projectHash: HASH,
    projectId: PROJECT_ID,
    tenantSchema: SCHEMA,
    access: "readwrite",
  });
  assert.match(sql, /"flux_tenant_ffca33f_rw"/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES/);
  assert.match(sql, /GRANT USAGE, SELECT ON ALL SEQUENCES/);
});

test("buildCreateTempDbAccessLoginRoleSql creates login role with expiry and search_path", () => {
  const sql = buildCreateTempDbAccessLoginRoleSql({
    projectHash: HASH,
    access: "readonly",
    suffix: "a1b2c3d4",
    password: "s3cret'pw",
    expiresAt: new Date("2026-06-20T22:00:00.000Z"),
    tenantSchema: SCHEMA,
  });
  assert.match(sql, /CREATE ROLE "flux_temp_ro_ffca33f_a1b2c3d4" LOGIN PASSWORD 's3cret''pw'/);
  assert.match(sql, /VALID UNTIL '2026-06-20T22:00:00.000Z'/);
  assert.match(sql, /GRANT "flux_tenant_ffca33f_ro" TO "flux_temp_ro_ffca33f_a1b2c3d4"/);
  assert.match(sql, /SET search_path = "t_5ecfa3ab72d1_api", public/);
});

test("buildCleanupExpiredTempDbAccessRolesSql scopes by project hash when provided", () => {
  const sql = buildCleanupExpiredTempDbAccessRolesSql(HASH);
  assert.match(sql, /\^flux_temp_\(ro\|rw\)_ffca33f_\[a-f0-9\]\{8\}\$/);
  assert.match(sql, /DROP ROLE IF EXISTS %I/);
});

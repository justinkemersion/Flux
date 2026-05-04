import test from "node:test";
import assert from "node:assert/strict";
import {
  TenantShortIdCollisionError,
  buildClusterBootstrapSql,
  buildTenantBootstrapSql,
  deriveTenantIdentity,
} from "./index.ts";

test("deriveTenantIdentity maps UUID to schema and role", () => {
  const id = deriveTenantIdentity("5ecfa3ab-72d1-4b3a-9c8e-111111111111");
  assert.equal(id.shortId, "5ecfa3ab72d1");
  assert.equal(id.schema, "t_5ecfa3ab72d1_api");
  assert.equal(id.role, "t_5ecfa3ab72d1_role");
});

test("deriveTenantIdentity rejects non-hex shortId prefix", () => {
  assert.throws(
    () => deriveTenantIdentity("zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz"),
    /invalid for tenant/,
  );
});

test("buildTenantBootstrapSql is idempotent-shaped and quotes identifiers", () => {
  const id = deriveTenantIdentity("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  const sql = buildTenantBootstrapSql(id, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS "t_aaaaaaaabbbb_api"/);
  assert.match(sql, /COMMENT ON SCHEMA "t_aaaaaaaabbbb_api" IS 'tenant:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'/);
  assert.match(sql, /CREATE ROLE "t_aaaaaaaabbbb_role"/);
  assert.match(sql, /GRANT USAGE ON SCHEMA "t_aaaaaaaabbbb_api" TO "t_aaaaaaaabbbb_role"/);
  assert.match(sql, /pg_notify\('pgrst', 'reload config'\)/);
  assert.match(sql, /CONNECTION LIMIT 25/);
});

test("buildTenantBootstrapSql respects FLUX_V2_ROLE_CONNECTION_LIMIT", () => {
  const prev = process.env.FLUX_V2_ROLE_CONNECTION_LIMIT;
  process.env.FLUX_V2_ROLE_CONNECTION_LIMIT = "10";
  try {
    const id = deriveTenantIdentity("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    const sql = buildTenantBootstrapSql(id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    assert.match(sql, /CONNECTION LIMIT 10/);
  } finally {
    if (prev === undefined) delete process.env.FLUX_V2_ROLE_CONNECTION_LIMIT;
    else process.env.FLUX_V2_ROLE_CONNECTION_LIMIT = prev;
  }
});

test("buildClusterBootstrapSql wires db_schemas and tenant context hook", () => {
  const sql = buildClusterBootstrapSql(20_000);
  assert.match(sql, /flux_postgrest_config/);
  assert.match(sql, /pgrst\.db_schemas/);
  assert.match(sql, /\^t_\[0-9a-f\]\{12\}_api\$/);
  assert.match(sql, /flux_set_tenant_context/);
  assert.match(sql, /SET LOCAL search_path/);
  assert.match(sql, /20000ms/);
});

test("TenantShortIdCollisionError exposes fields", () => {
  const err = new TenantShortIdCollisionError(
    "deadbeef0001",
    "new-tenant",
    "old-tenant",
  );
  assert.ok(err instanceof Error);
  assert.equal(err.shortId, "deadbeef0001");
  assert.equal(err.requestedTenantId, "new-tenant");
  assert.equal(err.existingTenantId, "old-tenant");
  assert.match(err.message, /ShortId collision/);
});

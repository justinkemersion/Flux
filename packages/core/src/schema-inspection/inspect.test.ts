import test from "node:test";
import assert from "node:assert/strict";
import { inspectTenantSchema, type TenantCatalogQueryFn } from "./inspect.ts";
import type { FluxCoreContext } from "../runtime/context.ts";

/**
 * Minimal stub for FluxCoreContext — only needed to satisfy the parameter type;
 * it is never accessed when an explicit queryRows fn is provided.
 */
const stubCtx = {} as unknown as FluxCoreContext;

/**
 * Stub TenantCatalogQueryFn that returns empty rows for every SQL string.
 * Sufficient for testing result shape and mode propagation without a real DB.
 */
const emptyQueryFn: TenantCatalogQueryFn = async (_sql) => [];

const BASE_OPTIONS = {
  slug: "test-project",
  hash: "abcdef1234567890",
  apiSchema: "t_abc123_api",
};

test("inspectTenantSchema — mode defaults to v1_dedicated when omitted", async () => {
  const result = await inspectTenantSchema(stubCtx, BASE_OPTIONS, emptyQueryFn);
  assert.equal(result.mode, "v1_dedicated");
});

test("inspectTenantSchema — mode is v1_dedicated when explicitly set", async () => {
  const result = await inspectTenantSchema(
    stubCtx,
    { ...BASE_OPTIONS, mode: "v1_dedicated" },
    emptyQueryFn,
  );
  assert.equal(result.mode, "v1_dedicated");
});

test("inspectTenantSchema — mode is v2_shared when set to v2_shared", async () => {
  const result = await inspectTenantSchema(
    stubCtx,
    { ...BASE_OPTIONS, mode: "v2_shared" },
    emptyQueryFn,
  );
  assert.equal(result.mode, "v2_shared");
});

test("inspectTenantSchema — result project fields are correct", async () => {
  const result = await inspectTenantSchema(
    stubCtx,
    { ...BASE_OPTIONS, mode: "v2_shared", apiUrl: "https://api.example.com" },
    emptyQueryFn,
  );
  assert.equal(result.project.slug, "test-project");
  assert.equal(result.project.hash, "abcdef1234567890");
  assert.equal(result.project.schema, "t_abc123_api");
  assert.equal(result.project.apiUrl, "https://api.example.com");
});

test("inspectTenantSchema — empty schema produces zero-table summary", async () => {
  const result = await inspectTenantSchema(
    stubCtx,
    { ...BASE_OPTIONS, mode: "v2_shared" },
    emptyQueryFn,
  );
  assert.equal(result.tables.length, 0);
  assert.equal(result.relationships.length, 0);
  assert.equal(result.summary.tableCount, 0);
  assert.ok(result.warnings.some((w) => w.code === "empty_schema"));
});

test("inspectTenantSchema — inspectedAt is an ISO timestamp", async () => {
  const result = await inspectTenantSchema(stubCtx, BASE_OPTIONS, emptyQueryFn);
  assert.ok(!Number.isNaN(Date.parse(result.inspectedAt)));
});

test("inspectTenantSchema — includeExactCounts does not throw on empty schema", async () => {
  const result = await inspectTenantSchema(
    stubCtx,
    { ...BASE_OPTIONS, mode: "v2_shared", includeExactCounts: true },
    emptyQueryFn,
  );
  assert.equal(result.tables.length, 0);
});

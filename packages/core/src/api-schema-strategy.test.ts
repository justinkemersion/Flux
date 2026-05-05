import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultTenantApiSchemaFromProjectId,
  resolveTenantApiSchemaName,
} from "./api-schema-strategy.ts";

test("defaultTenantApiSchemaFromProjectId derives t_<12hex>_api", () => {
  assert.equal(
    defaultTenantApiSchemaFromProjectId("550e8400-e29b-41d4-a716-446655440000"),
    "t_550e8400e29b_api",
  );
});

test("resolveTenantApiSchemaName: v2_shared ignores catalog strategy", () => {
  assert.equal(
    resolveTenantApiSchemaName({
      id: "550e8400-e29b-41d4-a716-446655440000",
      mode: "v2_shared",
      apiSchemaName: null,
      apiSchemaStrategy: "legacy_api",
    }),
    "t_550e8400e29b_api",
  );
});

test("resolveTenantApiSchemaName: v1 legacy uses api", () => {
  assert.equal(
    resolveTenantApiSchemaName({
      id: "550e8400-e29b-41d4-a716-446655440000",
      mode: "v1_dedicated",
      apiSchemaName: null,
      apiSchemaStrategy: "legacy_api",
    }),
    "api",
  );
});

test("resolveTenantApiSchemaName: v1 tenant_schema uses mirrored name", () => {
  assert.equal(
    resolveTenantApiSchemaName({
      id: "550e8400-e29b-41d4-a716-446655440000",
      mode: "v1_dedicated",
      apiSchemaName: null,
      apiSchemaStrategy: "tenant_schema",
    }),
    "t_550e8400e29b_api",
  );
});

test("explicit apiSchemaName wins", () => {
  assert.equal(
    resolveTenantApiSchemaName({
      id: "550e8400-e29b-41d4-a716-446655440000",
      mode: "v2_shared",
      apiSchemaName: "custom_api",
      apiSchemaStrategy: null,
    }),
    "custom_api",
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildMigrationPlanFromCatalogRow } from "./plan.ts";

test("buildMigrationPlanFromCatalogRow builds mirrored target schema", () => {
  const plan = buildMigrationPlanFromCatalogRow({
    id: "550e8400-e29b-41d4-a716-446655440000",
    slug: "demo",
    mode: "v2_shared",
    jwtSecret: "secret",
    hash: "a1b2c3d",
  });
  assert.equal(plan.tenantSchema, "t_550e8400e29b_api");
  assert.equal(plan.target.schema, plan.source.schema);
});

test("buildMigrationPlanFromCatalogRow rejects non-v2", () => {
  assert.throws(() =>
    buildMigrationPlanFromCatalogRow({
      id: "550e8400-e29b-41d4-a716-446655440000",
      slug: "demo",
      mode: "v1_dedicated",
      jwtSecret: "secret",
      hash: "a1b2c3d",
    }),
  );
});

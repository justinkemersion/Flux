import assert from "node:assert/strict";
import test from "node:test";
import { buildGauntletSchemaSql } from "./schema-fixtures";

test("v2 gauntlet privileges use only the pooled compatibility role", () => {
  const sql = buildGauntletSchemaSql("t_0123456789ab_api", "v2_shared");
  assert.match(sql, /TO authenticated/u);
  assert.doesNotMatch(sql, /\banon\b/u);
  assert.doesNotMatch(sql, /\bservice_role\b/u);
  assert.doesNotMatch(sql, /FOR ROLE postgres/u);
});

test("v1 gauntlet privileges retain dedicated PostgREST roles", () => {
  const sql = buildGauntletSchemaSql("api", "v1_dedicated");
  assert.match(sql, /anon, authenticated, service_role/u);
});

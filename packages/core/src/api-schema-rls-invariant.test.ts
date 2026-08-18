import assert from "node:assert/strict";
import test from "node:test";
import { buildAssertExposedApiSchemaHasRlsSql } from "./api-schema-rls-invariant.ts";

test("dedicated API RLS guard rejects disabled and policyless tables", () => {
  const sql = buildAssertExposedApiSchemaHasRlsSql("api");
  assert.match(sql, /NOT c\.relrowsecurity/u);
  assert.match(sql, /pg_catalog\.pg_policy/u);
  assert.match(sql, /Refusing push: exposed API table\(s\)/u);
  assert.match(sql, /ERRCODE = '42501'/u);
});

test("dedicated API RLS guard validates the schema identifier", () => {
  assert.throws(() => buildAssertExposedApiSchemaHasRlsSql("api; DROP SCHEMA public"));
});

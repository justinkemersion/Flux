import assert from "node:assert/strict";
import test from "node:test";
import { buildAssertExposedApiSchemaHasRlsSql } from "./api-schema-rls-invariant.ts";
import { UNRESTRICTED_WRITE_ERROR_PREFIX } from "./exposed-table-security.ts";

test("legacy dedicated API RLS export delegates to privilege-aware assertion", () => {
  const sql = buildAssertExposedApiSchemaHasRlsSql("api");
  assert.match(sql, /has_table_privilege/u);
  assert.match(sql, new RegExp(UNRESTRICTED_WRITE_ERROR_PREFIX.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(sql, /ERRCODE = '42501'/u);
});

test("legacy dedicated API RLS export validates the schema identifier", () => {
  assert.throws(() => buildAssertExposedApiSchemaHasRlsSql("api; DROP SCHEMA public"));
});

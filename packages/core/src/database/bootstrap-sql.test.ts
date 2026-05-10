import test from "node:test";
import assert from "node:assert/strict";
import { LEGACY_FLUX_API_SCHEMA } from "../api-schema-strategy.ts";
import { buildBootstrapSql, BOOTSTRAP_SQL, pgrstDbSchemasEnvValue } from "./bootstrap-sql.ts";

test("pgrstDbSchemasEnvValue lists api schema then public", () => {
  assert.equal(pgrstDbSchemasEnvValue("t_abc123_api"), "t_abc123_api,public");
});

test("buildBootstrapSql quotes schema identifier and includes role bootstrap", () => {
  const sql = buildBootstrapSql("t_test_api");
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS "t_test_api"/);
  assert.match(sql, /CREATE ROLE authenticator/);
});

test("BOOTSTRAP_SQL targets legacy api schema", () => {
  assert.match(
    BOOTSTRAP_SQL,
    new RegExp(
      `CREATE SCHEMA IF NOT EXISTS "${LEGACY_FLUX_API_SCHEMA.replace(/"/g, '""')}"`,
    ),
  );
});

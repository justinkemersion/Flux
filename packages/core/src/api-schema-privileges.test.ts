import test from "node:test";
import assert from "node:assert/strict";
import { LEGACY_FLUX_API_SCHEMA } from "./api-schema-strategy.ts";
import {
  API_SCHEMA_PRIVILEGES_SQL,
  buildApiSchemaPrivilegesSql,
  buildDisableRowLevelSecurityForSchemaSql,
  DISABLE_ROW_LEVEL_SECURITY_FOR_RLS_ENABLED_API_TABLES_SQL,
} from "./api-schema-privileges.ts";
import { assertNoDoubleStatementTerminator } from "./test/sql-assertions.ts";

test("buildApiSchemaPrivilegesSql grants on tenant schema", () => {
  const sql = buildApiSchemaPrivilegesSql("t_test_api");
  assert.match(sql, /GRANT USAGE ON SCHEMA "t_test_api"/);
  assertNoDoubleStatementTerminator(sql);
});

test("API_SCHEMA_PRIVILEGES_SQL targets legacy api schema", () => {
  assert.match(
    API_SCHEMA_PRIVILEGES_SQL,
    new RegExp(`GRANT USAGE ON SCHEMA "${LEGACY_FLUX_API_SCHEMA}"`),
  );
  assertNoDoubleStatementTerminator(API_SCHEMA_PRIVILEGES_SQL);
});

test("buildDisableRowLevelSecurityForSchemaSql emits DO block without double terminators", () => {
  const sql = buildDisableRowLevelSecurityForSchemaSql("t_test_api");
  assert.match(sql, /DO \$flux_disable_tenant_rls\$/);
  assertNoDoubleStatementTerminator(sql);
});

test("DISABLE_ROW_LEVEL_SECURITY_FOR_RLS_ENABLED_API_TABLES_SQL has no double terminators", () => {
  assertNoDoubleStatementTerminator(
    DISABLE_ROW_LEVEL_SECURITY_FOR_RLS_ENABLED_API_TABLES_SQL,
  );
});

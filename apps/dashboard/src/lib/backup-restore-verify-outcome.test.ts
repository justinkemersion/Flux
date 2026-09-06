import test from "node:test";
import assert from "node:assert/strict";
import { defaultTenantApiSchemaFromProjectId } from "@flux/core";
import {
  RESTORE_VERIFY_NO_USER_TABLES,
  RESTORE_VERIFY_SCHEMA_LIST_SQL,
  RESTORE_VERIFY_TABLE_COUNT_SQL,
  classifyRestoreVerification,
  parsePgRestoreList,
  parseRestoredSchemaList,
} from "./backup-restore-verify-outcome.ts";

const PROJECT_ID = "1ca6b7ce-b5d1-4f0f-87b2-7878806c9a00";
const TENANT_SCHEMA = defaultTenantApiSchemaFromProjectId(PROJECT_ID);

const EMPTY_TENANT_TOC = `
;
; Archive created at 2026-09-06 07:00:00 UTC
;     dbname: postgres
;     TOC Entries: 3
;     Compression: gzip
;     Dump Version: 1.16-0
;     Format: CUSTOM
;
;
; Selected TOC Entries:
;
2; 3079 16384 SCHEMA - ${TENANT_SCHEMA} postgres
3; 0 0 COMMENT - SCHEMA ${TENANT_SCHEMA} postgres
`;

const NON_EMPTY_TENANT_TOC = `
;
; Selected TOC Entries:
;
2; 3079 16384 SCHEMA - ${TENANT_SCHEMA} postgres
4; 1259 16385 TABLE ${TENANT_SCHEMA} items postgres
5; 0 0 TABLE DATA ${TENANT_SCHEMA} items postgres
6; 1259 16390 INDEX ${TENANT_SCHEMA} items_pkey postgres
`;

test("parsePgRestoreList extracts schema and ignores comments / TABLE DATA", () => {
  const empty = parsePgRestoreList(EMPTY_TENANT_TOC);
  assert.deepEqual(empty.schemas, [TENANT_SCHEMA]);
  assert.deepEqual(empty.tables, []);

  const populated = parsePgRestoreList(NON_EMPTY_TENANT_TOC);
  assert.deepEqual(populated.schemas, [TENANT_SCHEMA]);
  assert.deepEqual(populated.tables, [{ schema: TENANT_SCHEMA, name: "items" }]);
});

test("parseRestoredSchemaList trims psql -tA rows", () => {
  assert.deepEqual(
    parseRestoredSchemaList(`public\n${TENANT_SCHEMA}\n`),
    ["public", TENANT_SCHEMA],
  );
});

test("non-empty restore still succeeds without TOC inspection", () => {
  const outcome = classifyRestoreVerification({
    kind: "tenant_export",
    tableCount: 3,
    restoredSchemas: ["public", TENANT_SCHEMA],
    expectedTenantSchema: TENANT_SCHEMA,
    toc: null,
  });
  assert.deepEqual(outcome, { ok: true, classification: "restore_verified" });
});

test("empty tenant_export with schema after restore and empty TOC is restorable_empty_tenant", () => {
  const outcome = classifyRestoreVerification({
    kind: "tenant_export",
    tableCount: 0,
    restoredSchemas: ["public", TENANT_SCHEMA],
    expectedTenantSchema: TENANT_SCHEMA,
    toc: parsePgRestoreList(EMPTY_TENANT_TOC),
  });
  assert.deepEqual(outcome, {
    ok: true,
    classification: "restorable_empty_tenant",
  });
});

test("empty tenant_export fails when tenant schema is missing after restore", () => {
  const outcome = classifyRestoreVerification({
    kind: "tenant_export",
    tableCount: 0,
    restoredSchemas: ["public"],
    expectedTenantSchema: TENANT_SCHEMA,
    toc: parsePgRestoreList(EMPTY_TENANT_TOC),
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.match(outcome.error, /expected tenant schema t_1ca6b7ceb5d1_api not found/);
});

test("empty tenant_export fails when dump TOC is missing the tenant schema", () => {
  const outcome = classifyRestoreVerification({
    kind: "tenant_export",
    tableCount: 0,
    restoredSchemas: ["public", TENANT_SCHEMA],
    expectedTenantSchema: TENANT_SCHEMA,
    toc: { schemas: ["public"], tables: [] },
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.match(outcome.error, /dump TOC is missing expected tenant schema/);
});

test("empty restore fails when TOC listed user tables (corrupt / partial restore)", () => {
  const outcome = classifyRestoreVerification({
    kind: "tenant_export",
    tableCount: 0,
    restoredSchemas: ["public", TENANT_SCHEMA],
    expectedTenantSchema: TENANT_SCHEMA,
    toc: parsePgRestoreList(NON_EMPTY_TENANT_TOC),
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.match(outcome.error, /dump TOC lists 1 user table/);
  assert.notEqual(outcome.error, RESTORE_VERIFY_NO_USER_TABLES);
});

test("empty tenant_export fails closed when TOC could not be read", () => {
  const outcome = classifyRestoreVerification({
    kind: "tenant_export",
    tableCount: 0,
    restoredSchemas: ["public", TENANT_SCHEMA],
    expectedTenantSchema: TENANT_SCHEMA,
    toc: null,
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.match(outcome.error, /could not read dump TOC/);
});

test("empty project_db still fails (v1 dedicated is not the empty-tenant allow path)", () => {
  const outcome = classifyRestoreVerification({
    kind: "project_db",
    tableCount: 0,
    restoredSchemas: ["public", "api"],
    expectedTenantSchema: null,
    toc: { schemas: ["public", "api"], tables: [] },
  });
  assert.deepEqual(outcome, { ok: false, error: RESTORE_VERIFY_NO_USER_TABLES });
});

test("NaN or negative tableCount still fails", () => {
  for (const tableCount of [Number.NaN, -1]) {
    const outcome = classifyRestoreVerification({
      kind: "tenant_export",
      tableCount,
      restoredSchemas: [TENANT_SCHEMA],
      expectedTenantSchema: TENANT_SCHEMA,
      toc: parsePgRestoreList(EMPTY_TENANT_TOC),
    });
    assert.deepEqual(outcome, { ok: false, error: RESTORE_VERIFY_NO_USER_TABLES });
  }
});

test("inventory SQL stays scoped to user objects", () => {
  assert.match(RESTORE_VERIFY_TABLE_COUNT_SQL, /information_schema\.tables/);
  assert.match(RESTORE_VERIFY_TABLE_COUNT_SQL, /pg_catalog/);
  assert.match(RESTORE_VERIFY_SCHEMA_LIST_SQL, /pg_namespace/);
  assert.match(RESTORE_VERIFY_SCHEMA_LIST_SQL, /pg_temp_/);
});

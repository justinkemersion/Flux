import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  buildRepeatableLedgerEnsureSql,
  buildRepeatablePushSql,
  defaultRepeatableScriptId,
  inferDefaultSingleFilePushMode,
  parsePushScriptMode,
  resolveRepeatableLedgerAction,
  selectRepeatableChecksumSql,
} from "./sql-repeatable-scripts.ts";
import { assertNoDoubleStatementTerminator } from "./test/sql-assertions.ts";

test("parsePushScriptMode accepts raw, versioned, repeatable", () => {
  assert.equal(parsePushScriptMode("raw"), "raw");
  assert.equal(parsePushScriptMode("VERSIONED"), "versioned");
  assert.equal(parsePushScriptMode(" repeatable "), "repeatable");
  assert.equal(parsePushScriptMode("operation"), null);
});

test("resolveRepeatableLedgerAction: apply, skip, force", () => {
  const checksum = "a".repeat(64);
  assert.equal(
    resolveRepeatableLedgerAction(undefined, { checksum }, false),
    "apply",
  );
  assert.equal(
    resolveRepeatableLedgerAction({ checksum }, { checksum }, false),
    "skip",
  );
  assert.equal(
    resolveRepeatableLedgerAction({ checksum }, { checksum }, true),
    "force_apply",
  );
  assert.equal(
    resolveRepeatableLedgerAction({ checksum: "b".repeat(64) }, { checksum }, false),
    "apply",
  );
});

test("buildRepeatablePushSql sets run_count=1 on insert and increments on conflict", () => {
  const sql = buildRepeatablePushSql({
    tenantSchema: "t_abc_api",
    userSql: "SELECT 1;",
    meta: {
      scriptId: "flux/scripts/seed.sql",
      filename: "seed.sql",
      checksum: "c".repeat(64),
    },
  });
  assert.match(sql, /run_count, last_applied_at\)\s*VALUES\s*\([^)]*, 1, now\(\)\)/s);
  assert.match(sql, /run_count = flux\.flux_repeatable_scripts\.run_count \+ 1/);
  assertNoDoubleStatementTerminator(sql);
});

test("buildRepeatableLedgerEnsureSql has no double statement terminators", () => {
  const sql = buildRepeatableLedgerEnsureSql("t_abc_api");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS flux\.flux_repeatable_scripts/);
  assertNoDoubleStatementTerminator(sql);
});

test("selectRepeatableChecksumSql and buildRepeatablePushSql escape quotes via sqlLiteral", () => {
  const scriptId = "flux/it's.sql";
  const lookup = selectRepeatableChecksumSql(scriptId, "t_x_api");
  assert.match(lookup, /script_id = 'flux\/it''s\.sql'/);
  const wrapped = buildRepeatablePushSql({
    tenantSchema: "t_x_api",
    userSql: "SELECT 1;",
    meta: {
      scriptId,
      filename: "it's.sql",
      checksum: "d".repeat(64),
    },
  });
  assert.match(wrapped, /'flux\/it''s\.sql'/);
  assert.match(wrapped, /'it''s\.sql'/);
  assertNoDoubleStatementTerminator(wrapped);
});

test("defaultRepeatableScriptId uses normalized relative path", () => {
  const cwd = "/repo";
  const abs = resolve(cwd, "flux/scripts/seed_demo_users.sql");
  assert.equal(defaultRepeatableScriptId(abs, cwd), "flux/scripts/seed_demo_users.sql");
});

test("inferDefaultSingleFilePushMode", () => {
  const cwd = "/repo";
  assert.equal(
    inferDefaultSingleFilePushMode(resolve(cwd, "migrations/001.sql"), cwd),
    "versioned",
  );
  assert.equal(
    inferDefaultSingleFilePushMode(resolve(cwd, "flux/migrations/001.sql"), cwd),
    "versioned",
  );
  assert.equal(
    inferDefaultSingleFilePushMode(resolve(cwd, "flux/scripts/seed.sql"), cwd),
    "raw",
  );
});

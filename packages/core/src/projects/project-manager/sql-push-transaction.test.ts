import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDedicatedPushTransactionSql,
  UNRESTRICTED_WRITE_ERROR_PREFIX,
} from "../../exposed-table-security.ts";
import { buildMigrationPushSql } from "../../sql-migrations.ts";
import { assertNoDoubleStatementTerminator } from "../../test/sql-assertions.ts";

test("dedicated push transaction runs security inspection before COMMIT and ledger insert", () => {
  const userSql = buildMigrationPushSql({
    tenantSchema: "api",
    userSql: "CREATE TABLE mail_categories (id int);",
    migration: {
      version: "003_mail_categories.sql",
      filename: "003_mail_categories.sql",
      checksum: "abc123",
    },
  });
  const sql = buildDedicatedPushTransactionSql({
    searchPath: "api, public",
    userSql,
    apiSchema: "api",
  });

  const begin = sql.indexOf("BEGIN;");
  const create = sql.indexOf("CREATE TABLE mail_categories");
  const ledger = sql.indexOf("INSERT INTO flux.flux_migrations");
  const guard = sql.indexOf("$flux_exposed_sec$");
  const notify = sql.indexOf("NOTIFY pgrst, 'reload schema'");
  const commit = sql.indexOf("COMMIT;");

  assert.ok(begin >= 0);
  assert.ok(create > begin);
  assert.ok(ledger > create);
  assert.ok(guard > ledger);
  assert.ok(notify > guard);
  assert.ok(commit > notify);
  assert.equal(sql.indexOf("COMMIT;", commit + 1), -1);
  assert.match(sql, /has_table_privilege/u);
  assert.match(sql, new RegExp(UNRESTRICTED_WRITE_ERROR_PREFIX.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assertNoDoubleStatementTerminator(sql);
});

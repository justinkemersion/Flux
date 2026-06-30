import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APPLY_ACK_REFUSAL_MESSAGE,
  assertHarmlessSmokeMigration,
  buildSmokeMigrationSql,
  formatMigrationApplyWarning,
  parsePhase4SmokeArgs,
  PHASE4_SMOKE_APPLY_ACK_FLAG,
  smokeMigrationFilename,
} from "./phase4-smoke-lib";

test("parsePhase4SmokeArgs refuses missing hash", () => {
  const result = parsePhase4SmokeArgs(["--slug", "demo"]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /--hash/);
    assert.equal(result.exitCode, 2);
  }
});

test("parsePhase4SmokeArgs refuses missing slug", () => {
  const result = parsePhase4SmokeArgs(["--hash", "abc1234"]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /--slug/);
    assert.equal(result.exitCode, 2);
  }
});

test("parsePhase4SmokeArgs refuses positional arguments", () => {
  const result = parsePhase4SmokeArgs(["abc1234", "demo"]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /positional/i);
  }
});

test("parsePhase4SmokeArgs accepts explicit hash and slug", () => {
  const result = parsePhase4SmokeArgs(["--hash", "abc1234", "--slug", "demo"]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.hash, "abc1234");
    assert.equal(result.slug, "demo");
    assert.equal(result.applyAcknowledged, false);
  }
});

test("parsePhase4SmokeArgs records apply acknowledgement flag", () => {
  const result = parsePhase4SmokeArgs([
    "--hash",
    "abc1234",
    "--slug",
    "demo",
    PHASE4_SMOKE_APPLY_ACK_FLAG,
  ]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.applyAcknowledged, true);
  }
});

test("APPLY_ACK_REFUSAL_MESSAGE mentions acknowledgement flag", () => {
  assert.match(APPLY_ACK_REFUSAL_MESSAGE, /yes-apply-smoke-migration/);
});

test("buildSmokeMigrationSql is comment plus SELECT version only", () => {
  const sql = buildSmokeMigrationSql("deadbeef");
  assert.match(sql, /^-- flux mcp phase4 smoke deadbeef/m);
  assert.match(sql, /SELECT version\(\);/);
  assertHarmlessSmokeMigration(sql);
});

test("assertHarmlessSmokeMigration rejects DDL", () => {
  assert.throws(
    () => assertHarmlessSmokeMigration("CREATE TABLE t (id int);"),
    /must not contain/,
  );
});

test("formatMigrationApplyWarning includes slug hash filename and ledger note", () => {
  const warning = formatMigrationApplyWarning({
    slug: "demo",
    hash: "abc1234",
    filename: smokeMigrationFilename("test"),
  });
  assert.match(warning, /demo \(abc1234\)/);
  assert.match(warning, /9999_mcp_smoke_test\.sql/);
  assert.match(warning, /migration ledger/i);
  assert.match(warning, /Do not manually edit/i);
});

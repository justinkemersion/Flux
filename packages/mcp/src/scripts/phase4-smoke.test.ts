import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APPLY_ACK_REFUSAL_MESSAGE,
  PHASE4_SMOKE_ALLOW_NON_FIXTURE_FLAG,
  PHASE4_SMOKE_APPLY_ACK_FLAG,
  SUGGESTED_FIXTURE_SLUG,
  assertHarmlessSmokeMigration,
  buildNoopSmokeMigration,
  buildNoopSmokeMigrationSql,
  buildSmokeMigrationSql,
  formatMigrationApplyWarning,
  formatNonFixtureSlugRefusal,
  metadataLooksLikeFixture,
  noopSmokeMigrationFilename,
  parsePhase4SmokeArgs,
  slugLooksLikeFixture,
  smokeMigrationFilename,
} from "./phase4-smoke-lib";
import {
  assertNoopSmokeMigrationSql,
  buildNoopSmokeMigrationSql as buildSqlDirect,
  noopSmokeMigrationFilename as filenameDirect,
} from "./smoke-migration";

test("parsePhase4SmokeArgs refuses missing hash", () => {
  const result = parsePhase4SmokeArgs(["--slug", "mcp-smoke-fixture"]);
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
  const result = parsePhase4SmokeArgs(["abc1234", "mcp-smoke-fixture"]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /positional/i);
  }
});

test("parsePhase4SmokeArgs accepts fixture-looking slug with apply ack", () => {
  const result = parsePhase4SmokeArgs([
    "--hash",
    "abc1234",
    "--slug",
    SUGGESTED_FIXTURE_SLUG,
    PHASE4_SMOKE_APPLY_ACK_FLAG,
  ]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.hash, "abc1234");
    assert.equal(result.slug, SUGGESTED_FIXTURE_SLUG);
    assert.equal(result.applyAcknowledged, true);
    assert.equal(result.slugLooksLikeFixture, true);
    assert.equal(result.allowNonFixtureProject, false);
  }
});

test("parsePhase4SmokeArgs refuses non-fixture slug without override", () => {
  const result = parsePhase4SmokeArgs(["--hash", "abc1234", "--slug", "bloom-atelier"]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /does not look like a fixture/i);
    assert.match(result.error, /allow-non-fixture-project/);
    assert.equal(result.exitCode, 2);
  }
});

test("parsePhase4SmokeArgs allows non-fixture slug only with explicit override", () => {
  const result = parsePhase4SmokeArgs([
    "--hash",
    "abc1234",
    "--slug",
    "bloom-atelier",
    PHASE4_SMOKE_ALLOW_NON_FIXTURE_FLAG,
  ]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.slugLooksLikeFixture, false);
    assert.equal(result.allowNonFixtureProject, true);
  }
});

test("slugLooksLikeFixture matches smoke fixture and test slugs", () => {
  assert.equal(slugLooksLikeFixture("mcp-smoke-fixture"), true);
  assert.equal(slugLooksLikeFixture("flux-mcp-test"), true);
  assert.equal(slugLooksLikeFixture("my-fixture-db"), true);
  assert.equal(slugLooksLikeFixture("bloom-atelier"), false);
});

test("parsePhase4SmokeArgs records apply acknowledgement flag", () => {
  const result = parsePhase4SmokeArgs([
    "--hash",
    "abc1234",
    "--slug",
    "mcp-smoke-fixture",
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

test("formatNonFixtureSlugRefusal mentions suggested fixture slug", () => {
  assert.match(formatNonFixtureSlugRefusal("production-app"), /mcp-smoke-fixture/);
});

test("noop smoke migration filename uses mcp_noop_smoke prefix", () => {
  const name = noopSmokeMigrationFilename("deadbeef");
  assert.match(name, /^9999_mcp_noop_smoke_deadbeef\.sql$/);
  assert.equal(smokeMigrationFilename("deadbeef"), name);
  assert.equal(filenameDirect("deadbeef"), name);
});

test("buildNoopSmokeMigrationSql is comment plus SELECT version only", () => {
  const sql = buildNoopSmokeMigrationSql("deadbeef");
  assert.match(sql, /^-- flux mcp noop smoke deadbeef/m);
  assert.match(sql, /SELECT version\(\);/);
  assertNoopSmokeMigrationSql(sql);
  assert.equal(buildSmokeMigrationSql("deadbeef"), buildSqlDirect("deadbeef"));
});

test("buildNoopSmokeMigration returns safe artifact metadata", () => {
  const artifact = buildNoopSmokeMigration("abc");
  assert.match(artifact.filename, /mcp_noop_smoke/);
  assert.equal(artifact.logMeta.kind, "mcp_noop_smoke");
  assertNoopSmokeMigrationSql(artifact.sql);
});

test("assertNoopSmokeMigrationSql rejects DDL", () => {
  assert.throws(
    () => assertNoopSmokeMigrationSql("CREATE TABLE t (id int);"),
    /must not contain/,
  );
});

test("assertNoopSmokeMigrationSql rejects DML", () => {
  assert.throws(
    () => assertHarmlessSmokeMigration("SELECT 1;\nINSERT INTO t VALUES (1);"),
    /must not contain/,
  );
  assert.throws(
    () => assertNoopSmokeMigrationSql("SELECT 1;\nUPDATE t SET x = 1;"),
    /must not contain/,
  );
});

test("formatMigrationApplyWarning includes slug hash filename and ledger note", () => {
  const warning = formatMigrationApplyWarning({
    slug: "mcp-smoke-fixture",
    hash: "abc1234",
    filename: noopSmokeMigrationFilename("test"),
  });
  assert.match(warning, /mcp-smoke-fixture \(abc1234\)/);
  assert.match(warning, /9999_mcp_noop_smoke_test\.sql/);
  assert.match(warning, /migration ledger/i);
  assert.match(warning, /Do not manually edit/i);
});

test("metadataLooksLikeFixture detects fixture description", () => {
  assert.equal(
    metadataLooksLikeFixture({
      slug: "mcp-smoke-fixture",
      description: "Disposable MCP smoke fixture",
    }),
    true,
  );
  assert.equal(
    metadataLooksLikeFixture({
      slug: "my-app",
      description: "Production customer app",
    }),
    false,
  );
});

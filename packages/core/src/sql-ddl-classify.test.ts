import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyMigrationSql,
  formatDdlSummaryLines,
  stripSqlComments,
} from "./sql-ddl-classify.ts";

test("stripSqlComments removes line and block comments", () => {
  const sql = `-- header
CREATE TABLE t (id int); /* inline */
`;
  assert.match(stripSqlComments(sql), /CREATE TABLE t/);
  assert.doesNotMatch(stripSqlComments(sql), /-- header/);
  assert.doesNotMatch(stripSqlComments(sql), /inline/);
});

test("classifyMigrationSql detects create and alter", () => {
  const sql = `
CREATE TABLE issues (id uuid primary key);
CREATE TABLE issue_photos (id uuid primary key);
ALTER TABLE photos ADD COLUMN visibility text;
ALTER TABLE photos ADD COLUMN published_at timestamptz;
`;
  const s = classifyMigrationSql(sql);
  assert.equal(s.heuristic, true);
  assert.deepEqual(s.creates, ["issue_photos", "issues"]);
  assert.deepEqual(s.alters, ["photos.published_at", "photos.visibility"]);
  assert.equal(s.hasDestructive, false);
});

test("classifyMigrationSql flags drop table warnings", () => {
  const sql = "DROP TABLE legacy_tags;";
  const s = classifyMigrationSql(sql);
  assert.deepEqual(s.drops, ["legacy_tags"]);
  assert.match(s.warnings.join(" "), /DROP TABLE legacy_tags/);
  assert.equal(s.hasDestructive, true);
  const lines = formatDdlSummaryLines(s);
  assert.ok(lines.some((l) => l.startsWith("Warning:")));
});

test("classifyMigrationSql detects policies and RLS", () => {
  const sql = `
CREATE POLICY issues_select ON issues FOR SELECT USING (true);
ALTER TABLE issues ENABLE ROW LEVEL SECURITY;
`;
  const s = classifyMigrationSql(sql);
  assert.ok(s.policyChanges.some((p) => p.includes("issues_select")));
  assert.ok(s.rlsChanges.some((r) => r.includes("enable RLS")));
});

test("classifyMigrationSql parses IF NOT EXISTS on indexes and columns", () => {
  const sql = `
ALTER TABLE object_photos ADD COLUMN IF NOT EXISTS is_primary boolean;
CREATE INDEX IF NOT EXISTS object_photos_primary_idx ON object_photos (object_id);
`;
  const s = classifyMigrationSql(sql);
  assert.deepEqual(s.alters, ["object_photos.is_primary"]);
  assert.deepEqual(s.indexCreates, ["object_photos_primary_idx"]);
});

test("classifyMigrationSql does not treat ENABLE RLS as table alter", () => {
  const sql = `
CREATE TABLE profiles (id uuid primary key);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
`;
  const s = classifyMigrationSql(sql);
  assert.deepEqual(s.creates, ["profiles"]);
  assert.deepEqual(s.alters, []);
  assert.ok(s.rlsChanges.some((r) => r.includes("profiles")));
});

test("formatDdlSummaryLines empty fallback mentions heuristic", () => {
  const lines = formatDdlSummaryLines(classifyMigrationSql("SELECT 1;"));
  assert.ok(lines.some((l) => l.includes("heuristic")));
});

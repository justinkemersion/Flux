import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const SQL_DIR = join(REPO_ROOT, "bin", "ops-audit", "sql");

function readSql(name: string): string {
  return readFileSync(join(SQL_DIR, name), "utf8");
}

test("backup-catalog-latest.sql keys projects by id and exposes slug + hash", () => {
  const sql = readSql("backup-catalog-latest.sql");
  assert.match(sql, /DISTINCT ON \(p\.id\)/);
  assert.doesNotMatch(sql, /DISTINCT ON \(p\.slug\)/);
  assert.match(sql, /p\.slug/);
  assert.match(sql, /p\.hash/);
  assert.match(sql, /lifecycle_state/);
});

test("platform-backup-freshness.sql keys projects by slug + hash and skips non-active lifecycle", () => {
  const sql = readSql("platform-backup-freshness.sql");
  assert.match(sql, /p\.slug/);
  assert.match(sql, /p\.hash/);
  assert.match(sql, /lifecycle_state[\s\S]*active/);
  assert.doesNotMatch(sql, /DISTINCT ON \(p\.slug\)/);
});

/**
 * Fixture: two catalog rows share slug yeastcoast but differ by hash/mode.
 * ops-audit must evaluate both independently (no slug collapse).
 */
test("duplicate slug fixture — two projects must remain distinct audit rows", () => {
  const rows = [
    {
      slug: "yeastcoast",
      hash: "ffca33f",
      mode: "v1_dedicated",
      lifecycle_state: "active",
      restore: "restore_verified",
    },
    {
      slug: "yeastcoast",
      hash: "3db3f78",
      mode: "v2_shared",
      lifecycle_state: "archived",
      restore: "restore_failed",
    },
  ];
  const keys = rows.map((r) => `${r.slug}:${r.hash}`);
  assert.equal(new Set(keys).size, 2, "slug alone must not dedupe projects");
  const activeFails = rows.filter(
    (r) =>
      r.lifecycle_state === "active" && r.restore === "restore_failed",
  );
  assert.equal(activeFails.length, 0);
  const archivedFails = rows.filter(
    (r) =>
      r.lifecycle_state === "archived" && r.restore === "restore_failed",
  );
  assert.equal(archivedFails.length, 1);
});

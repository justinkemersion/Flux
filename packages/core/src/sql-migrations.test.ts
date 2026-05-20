import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildMigrationPushSql,
  listMigrationSqlFiles,
  loadLocalMigrations,
  migrationChecksum,
  migrationConflictMessage,
  migrationPlanTimeline,
  planMigrations,
  resolveMigrationLedgerAction,
  sqlLiteral,
} from "./sql-migrations.ts";

test("migrationChecksum is stable sha256 hex", () => {
  const a = migrationChecksum("select 1;\n");
  const b = migrationChecksum("select 1;\n");
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/u);
  assert.notEqual(migrationChecksum("select 2;"), a);
});

test("sqlLiteral escapes single quotes", () => {
  assert.equal(sqlLiteral("it's"), "'it''s'");
});

test("migrationPlanTimeline sorts by version regardless of status", () => {
  const local = [
    {
      version: "024_room.sql",
      filename: "024_room.sql",
      path: "/m/024",
      content: "b",
      checksum: migrationChecksum("b"),
    },
    {
      version: "023_init.sql",
      filename: "023_init.sql",
      path: "/m/023",
      content: "a",
      checksum: migrationChecksum("a"),
    },
  ];
  const applied = [
    {
      version: "023_init.sql",
      filename: "023_init.sql",
      checksum: migrationChecksum("a"),
    },
  ];
  const plan = planMigrations(local, applied);
  const timeline = migrationPlanTimeline(plan);
  assert.equal(timeline.length, 2);
  assert.equal(timeline[0]?.status, "skip");
  assert.equal(timeline[0]?.file.version, "023_init.sql");
  assert.equal(timeline[1]?.status, "apply");
  assert.equal(timeline[1]?.file.version, "024_room.sql");
});

test("planMigrations: skip, apply, conflict", () => {
  const local = [
    {
      version: "001_a.sql",
      filename: "001_a.sql",
      path: "/m/001_a.sql",
      content: "a",
      checksum: migrationChecksum("a"),
    },
    {
      version: "002_b.sql",
      filename: "002_b.sql",
      path: "/m/002_b.sql",
      content: "b",
      checksum: migrationChecksum("b"),
    },
    {
      version: "003_c.sql",
      filename: "003_c.sql",
      path: "/m/003_c.sql",
      content: "c2",
      checksum: migrationChecksum("c2"),
    },
  ];
  const applied = [
    {
      version: "001_a.sql",
      filename: "001_a.sql",
      checksum: migrationChecksum("a"),
    },
    {
      version: "003_c.sql",
      filename: "003_c.sql",
      checksum: migrationChecksum("c1"),
    },
  ];
  const plan = planMigrations(local, applied);
  assert.equal(plan.skip.length, 1);
  assert.equal(plan.skip[0]?.version, "001_a.sql");
  assert.equal(plan.apply.length, 1);
  assert.equal(plan.apply[0]?.version, "002_b.sql");
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0]?.file.version, "003_c.sql");
});

test("resolveMigrationLedgerAction", () => {
  const m = { version: "a.sql", filename: "a.sql", checksum: "x" };
  assert.equal(resolveMigrationLedgerAction(undefined, m), "apply");
  assert.equal(resolveMigrationLedgerAction({ checksum: "x" }, m), "skip");
  assert.equal(resolveMigrationLedgerAction({ checksum: "y" }, m), "conflict");
});

test("migrationConflictMessage is direct and names both checksums", () => {
  const msg = migrationConflictMessage(
    {
      version: "024_room.sql",
      filename: "024_room_candidate_status.sql",
      checksum: "c".repeat(64),
    },
    "a".repeat(64),
  );
  assert.match(msg, /^Migration checksum conflict/m);
  assert.match(msg, /024_room_candidate_status\.sql was already applied/);
  assert.ok(msg.includes(`Applied checksum: ${"a".repeat(64)}`));
  assert.ok(msg.includes(`Current checksum: ${"c".repeat(64)}`));
  assert.match(msg, /Create a new migration instead of editing an applied migration/);
});

test("buildMigrationPushSql includes DDL, user sql, insert", () => {
  const sql = buildMigrationPushSql({
    userSql: "CREATE TABLE foo (id int);",
    migration: {
      version: "001_init.sql",
      filename: "001_init.sql",
      checksum: "abc123",
    },
  });
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS flux/);
  assert.match(sql, /flux\.flux_migrations/);
  assert.match(sql, /CREATE TABLE foo/);
  assert.match(sql, /INSERT INTO flux\.flux_migrations/);
  assert.match(sql, /'001_init\.sql'/);
  assert.match(sql, /'abc123'/);
});

test("listMigrationSqlFiles sorts lexicographically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flux-mig-"));
  try {
    await writeFile(join(dir, "010_z.sql"), "-- z");
    await writeFile(join(dir, "002_a.sql"), "-- a");
    await writeFile(join(dir, "readme.txt"), "nope");
    const paths = await listMigrationSqlFiles(dir);
    assert.equal(paths.length, 2);
    assert.ok(paths[0]?.endsWith("002_a.sql"));
    assert.ok(paths[1]?.endsWith("010_z.sql"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("listMigrationSqlFiles errors when no sql files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flux-mig-empty-"));
  try {
    await writeFile(join(dir, "readme.txt"), "nope");
    await assert.rejects(() => listMigrationSqlFiles(dir), /No \.sql files/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadLocalMigrations sets version from basename", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flux-mig-load-"));
  try {
    const p = join(dir, "003_test.sql");
    await writeFile(p, "SELECT 1;");
    const loaded = await loadLocalMigrations([p]);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]?.version, "003_test.sql");
    assert.equal(loaded[0]?.checksum, migrationChecksum("SELECT 1;"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

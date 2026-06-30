import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationChecksum, type FluxMigrationRecord } from "@flux/core/sql-migrations";
import { buildMigrationPlan } from "./migration-plan";
import { getMigrationPlan } from "../plan-store";

const FILE_A = "0001_init.sql";
const FILE_B = "0002_drop.sql";
const SQL_A = "CREATE TABLE widgets (id uuid PRIMARY KEY);\n";
const SQL_B = "DROP TABLE widgets;\n";

function makeWorkspace(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "flux-mcp-plan-"));
  const dir = join(root, "migrations");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, FILE_A), SQL_A);
  writeFileSync(join(dir, FILE_B), SQL_B);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const noneApplied = async (): Promise<FluxMigrationRecord[]> => [];

test("plans both files when none are applied", async () => {
  const ws = makeWorkspace();
  try {
    const data = await buildMigrationPlan(
      { hash: "abc1234", workspaceRoot: ws.root, migrationsPath: "migrations" },
      noneApplied,
    );
    assert.equal(data.counts.apply, 2);
    assert.equal(data.counts.skip, 0);
    assert.equal(data.counts.conflicts, 0);
    assert.deepEqual(
      data.apply.map((f) => f.filename),
      [FILE_A, FILE_B],
    );
    // DROP TABLE makes the plan destructive-shaped.
    assert.equal(data.destructiveShaped, true);
    assert.ok(data.warnings.some((w) => w.includes("DROP TABLE")));
    // Plan is stored in memory and retrievable by planId.
    assert.ok(getMigrationPlan(data.planId));
  } finally {
    ws.cleanup();
  }
});

test("planHash is stable across runs for identical inputs", async () => {
  const ws = makeWorkspace();
  try {
    const a = await buildMigrationPlan(
      { hash: "abc1234", workspaceRoot: ws.root, migrationsPath: "migrations" },
      noneApplied,
    );
    const b = await buildMigrationPlan(
      { hash: "abc1234", workspaceRoot: ws.root, migrationsPath: "migrations" },
      noneApplied,
    );
    assert.equal(a.planHash, b.planHash);
    assert.notEqual(a.planId, b.planId); // planId is per-run
  } finally {
    ws.cleanup();
  }
});

test("skips files whose checksum matches the applied ledger", async () => {
  const ws = makeWorkspace();
  try {
    const applied: FluxMigrationRecord[] = [
      {
        version: FILE_A,
        filename: FILE_A,
        checksum: migrationChecksum(SQL_A),
      },
    ];
    const data = await buildMigrationPlan(
      { hash: "abc1234", workspaceRoot: ws.root, migrationsPath: "migrations" },
      async () => applied,
    );
    assert.equal(data.counts.skip, 1);
    assert.equal(data.skip[0]!.filename, FILE_A);
    assert.equal(data.counts.apply, 1);
    assert.equal(data.apply[0]!.filename, FILE_B);
  } finally {
    ws.cleanup();
  }
});

test("flags a checksum conflict when applied content differs", async () => {
  const ws = makeWorkspace();
  try {
    const applied: FluxMigrationRecord[] = [
      { version: FILE_A, filename: FILE_A, checksum: "different-checksum" },
    ];
    const data = await buildMigrationPlan(
      { hash: "abc1234", workspaceRoot: ws.root, migrationsPath: "migrations" },
      async () => applied,
    );
    assert.equal(data.counts.conflicts, 1);
    assert.equal(data.conflicts[0]!.filename, FILE_A);
    assert.equal(data.conflicts[0]!.appliedChecksum, "different-checksum");
  } finally {
    ws.cleanup();
  }
});

test("rejects a missing migrations path", async () => {
  const ws = makeWorkspace();
  try {
    await assert.rejects(
      () =>
        buildMigrationPlan(
          { hash: "abc1234", workspaceRoot: ws.root, migrationsPath: "does-not-exist" },
          noneApplied,
        ),
      /does not exist/,
    );
  } finally {
    ws.cleanup();
  }
});

test("requires migrationsPath", async () => {
  const ws = makeWorkspace();
  try {
    await assert.rejects(
      () => buildMigrationPlan({ hash: "abc1234", workspaceRoot: ws.root }, noneApplied),
      /migrationsPath is required/,
    );
  } finally {
    ws.cleanup();
  }
});

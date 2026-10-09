import test from "node:test";
import assert from "node:assert/strict";
import {
  migrationChecksum,
  planMigrations,
  type LocalMigrationFile,
} from "@flux/core/sql-migrations";
import {
  assertMigrationPlanReadyForDryRun,
  printMigrationPlan,
  printSingleFilePushPreview,
} from "./migrations-output.ts";

function localFile(version: string, content: string): LocalMigrationFile {
  return {
    version,
    filename: version,
    path: `/m/${version}`,
    content,
    checksum: migrationChecksum(content),
  };
}

test("assertMigrationPlanReadyForDryRun throws on checksum conflict", () => {
  const local = [localFile("001.sql", "new")];
  const applied = [
    {
      version: "001.sql",
      filename: "001.sql",
      checksum: migrationChecksum("old"),
    },
  ];
  const plan = planMigrations(local, applied);
  assert.throws(
    () => assertMigrationPlanReadyForDryRun(plan),
    /Migration checksum conflict/,
  );
});

test("printMigrationPlan counts apply skip and conflicts", () => {
  const plan = planMigrations(
    [localFile("002.sql", "b"), localFile("003.sql", "c")],
    [localFile("001.sql", "a")].map((f) => ({
      version: f.version,
      filename: f.filename,
      checksum: f.checksum,
    })),
  );
  const counts = printMigrationPlan({ plan, mode: "plan" });
  assert.equal(counts.wouldApply, 2);
  assert.equal(counts.wouldSkip, 0);
  assert.equal(counts.conflicts, 0);
});

test("printMigrationPlan includes ddl summary for pending create table", () => {
  const sql = "CREATE TABLE widgets (id uuid primary key);";
  const plan = planMigrations([localFile("001_widgets.sql", sql)], []);
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    printMigrationPlan({ plan, mode: "plan" });
  } finally {
    console.log = orig;
  }
  assert.ok(lines.some((l) => l.includes("Pending migrations: 1")));
  assert.ok(lines.some((l) => l.includes("widgets")));
});

function captureLog(fn: () => void): string {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.log = orig;
  }
  return lines.join("\n");
}

test("printSingleFilePushPreview raw keeps the unrecorded line", () => {
  const text = captureLog(() => {
    printSingleFilePushPreview({
      filePath: "/repo/seed.sql",
      slug: "demo",
      schemaHint: "v2_shared",
      mode: "dry-run",
      scriptMode: "raw",
    });
  });
  assert.match(
    text,
    /Single-file push \(raw SQL, not recorded in flux\.flux_migrations\)\./,
  );
  assert.match(text, /Dry run OK\. Nothing applied\./);
  assert.doesNotMatch(text, /Versioned migration:/);
  assert.doesNotMatch(text, /flux\.flux_repeatable_scripts/);
});

test("printSingleFilePushPreview versioned names basename and checksum prefix", () => {
  const sql = "select 1;\n";
  const checksum = migrationChecksum(sql);
  const text = captureLog(() => {
    printSingleFilePushPreview({
      filePath: "/repo/sql/migrations/0018_x.sql",
      slug: "demo",
      schemaHint: "v2_shared",
      mode: "dry-run",
      scriptMode: "versioned",
      checksum,
    });
  });
  assert.match(
    text,
    new RegExp(
      `Versioned migration: on apply, recorded in flux\\.flux_migrations as version 0018_x\\.sql \\(checksum ${checksum.slice(0, 12)}\\)\\. Skipped if already applied with the same checksum; fails on a checksum conflict\\. This dry run did not check the ledger\\.`,
    ),
  );
  assert.doesNotMatch(text, /not recorded in flux\.flux_migrations/);
});

test("printSingleFilePushPreview repeatable names the script id", () => {
  const text = captureLog(() => {
    printSingleFilePushPreview({
      filePath: "/repo/flux/scripts/seed.sql",
      slug: "demo",
      schemaHint: "v2_shared",
      mode: "dry-run",
      scriptMode: "repeatable",
      scriptId: "flux/scripts/seed.sql",
    });
  });
  assert.match(
    text,
    /Repeatable script: on apply, recorded in flux\.flux_repeatable_scripts under script id flux\/scripts\/seed\.sql\. An unchanged checksum is skipped unless --force; a changed checksum is reapplied\. This dry run did not check the ledger\./,
  );
  assert.doesNotMatch(text, /fails on a checksum conflict/);
  assert.doesNotMatch(text, /not recorded in flux\.flux_migrations/);
});

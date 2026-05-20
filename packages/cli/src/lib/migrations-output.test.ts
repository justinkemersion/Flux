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

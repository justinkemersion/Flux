import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The pooled readiness gate is only worth anything if it runs before SQL leaves the process.
 * A gate placed after the first transport call would report the same message while the
 * migration had already been adapted by an unverified control plane.
 */
const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "push.ts"),
  "utf8",
);

test("pooled gate is armed for apply mode on v2_shared only", () => {
  assert.match(
    source,
    /options\.pushMode === "apply" &&\s*metadata\.mode === "v2_shared"/u,
  );
  assert.match(source, /assertControlPlaneReadyForPooledMigration\(\)/u);
});

test("pooled gate runs before any SQL is transported", () => {
  const gateAt = source.indexOf("assertControlPlaneReadyForPooledMigration()");
  assert.ok(gateAt > 0, "gate must be present");

  for (const transport of [
    "client.pushSql(",
    "client.importSqlFile(",
    "pushSqlV2Push(",
    "pushSqlV2Raw(",
    "pushSqlV2Migration(",
    "pushMigrationFile(",
  ]) {
    const at = source.indexOf(transport);
    if (at < 0) continue;
    assert.ok(
      gateAt < at,
      `${transport} appears before the readiness gate; SQL could reach an unverified control plane`,
    );
  }
});

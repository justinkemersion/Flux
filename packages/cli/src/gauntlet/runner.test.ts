import assert from "node:assert/strict";
import test from "node:test";
import { shouldAttemptCleanup } from "./cleanup";
import { parseGauntletRuns, resolveGauntletMode } from "./runner-options";
import type { GauntletRunOptions } from "./types";

const baseOptions = (): GauntletRunOptions => ({
  mode: "v1_dedicated",
  runs: 1,
  keepFailed: false,
  reportDir: "reports/gauntlet",
  prefix: "gauntlet",
  skipBackup: false,
  json: false,
});

test("shouldAttemptCleanup respects keep-failed on failure", () => {
  const opts = { ...baseOptions(), keepFailed: true };
  assert.equal(shouldAttemptCleanup(opts, true), false);
  assert.equal(shouldAttemptCleanup(opts, false), true);
  assert.equal(shouldAttemptCleanup(baseOptions(), true), true);
});

test("parseGauntletRuns validates positive integer", () => {
  assert.equal(parseGauntletRuns("3"), 3);
  assert.throws(() => parseGauntletRuns("0"), /--runs must be a positive integer/u);
  assert.throws(() => parseGauntletRuns("nope"), /--runs must be a positive integer/u);
});

test("resolveGauntletMode accepts v1 and v2", () => {
  assert.equal(resolveGauntletMode(undefined), "v1_dedicated");
  assert.equal(resolveGauntletMode("v2_shared"), "v2_shared");
  assert.throws(() => resolveGauntletMode("invalid"), /--mode must be/u);
});

import test from "node:test";
import assert from "node:assert/strict";
import { resolvePlatformBackupSchedulerBatchSize } from "@flux/core/backup-policy";
import { getPlatformBackupPolicy } from "./backup-platform-policy.js";

test("launch bootstrap batch exceeds steady-state cap", () => {
  const policy = getPlatformBackupPolicy();
  const bootstrap = resolvePlatformBackupSchedulerBatchSize({
    dueCount: 8,
    maxPipelinesPerTick: policy.maxPipelinesPerTick,
    bootstrapMaxPipelinesOnFirstRun: policy.bootstrapMaxPipelinesOnFirstRun,
    isFirstRun: true,
  });
  const steady = resolvePlatformBackupSchedulerBatchSize({
    dueCount: 8,
    maxPipelinesPerTick: policy.maxPipelinesPerTick,
    bootstrapMaxPipelinesOnFirstRun: policy.bootstrapMaxPipelinesOnFirstRun,
    isFirstRun: false,
  });
  assert.ok(bootstrap > steady);
  assert.equal(steady, policy.maxPipelinesPerTick);
});

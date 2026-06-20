import test from "node:test";
import assert from "node:assert/strict";
import {
  getPlatformBackupPolicy,
  isSchedulerExcludedProject,
} from "./backup-platform-policy.js";

test("getPlatformBackupPolicy merges FLUX_DEMO_USER_ID into exclusions", () => {
  const prev = process.env.FLUX_DEMO_USER_ID;
  process.env.FLUX_DEMO_USER_ID = "demo-owner-uuid";
  try {
    const policy = getPlatformBackupPolicy();
    assert.ok(policy.excludeUserIds.has("demo-owner-uuid"));
  } finally {
    if (prev === undefined) delete process.env.FLUX_DEMO_USER_ID;
    else process.env.FLUX_DEMO_USER_ID = prev;
  }
});

test("isSchedulerExcludedProject excludes flux-system and static", () => {
  assert.equal(
    isSchedulerExcludedProject({ slug: "flux-system", userId: "any" }),
    true,
  );
  assert.equal(
    isSchedulerExcludedProject({ slug: "static", userId: "any" }),
    true,
  );
  assert.equal(
    isSchedulerExcludedProject({ slug: "my-app", userId: "regular-user" }),
    false,
  );
});

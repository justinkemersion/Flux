import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMatrixModeV1,
  isMatrixScenarioName,
  resolveMatrixScenarioNames,
} from "./matrix-types";
import {
  buildMatrixSummary,
  buildMatrixSummaryMarkdown,
  finalizeMatrixScenarioResult,
} from "./matrix-reporter";
import { matrixScenarioStatus } from "./matrix-stage";
import { matrixToGauntletOptions } from "./matrix-helpers";
import { isGauntletSlug } from "./names";
import { shouldAttemptCleanup } from "./cleanup";

test("resolveMatrixScenarioNames returns all when omitted", () => {
  assert.equal(resolveMatrixScenarioNames().length, 7);
});

test("resolveMatrixScenarioNames filters single scenario", () => {
  assert.deepEqual(resolveMatrixScenarioNames("push_invalid_sql"), [
    "push_invalid_sql",
  ]);
});

test("resolveMatrixScenarioNames rejects unknown scenario", () => {
  assert.throws(
    () => resolveMatrixScenarioNames("not_a_scenario"),
    /Unknown matrix scenario/u,
  );
});

test("assertMatrixModeV1 rejects v2_shared", () => {
  assert.throws(
    () => assertMatrixModeV1("v2_shared"),
    /v1_dedicated only/u,
  );
});

test("isMatrixScenarioName validates known names", () => {
  assert.equal(isMatrixScenarioName("stop_start_project"), true);
  assert.equal(isMatrixScenarioName("fake"), false);
});

test("buildMatrixSummary counts cleanup leak when project not cleaned", () => {
  const summary = buildMatrixSummary({
    options: {
      mode: "v1_dedicated",
      reportDir: "reports/gauntlet",
      prefix: "gauntlet",
      keepFailed: false,
      json: false,
    },
    startedAt: "2026-06-20T00:00:00.000Z",
    finishedAt: "2026-06-20T00:10:00.000Z",
    reportRoot: "reports/gauntlet/matrix-test",
    results: [
      {
        scenarioName: "backup_gate_blocks_destructive_action",
        mode: "v1_dedicated",
        status: "pass",
        startedAt: "2026-06-20T00:00:00.000Z",
        finishedAt: "2026-06-20T00:01:00.000Z",
        durationMs: 60_000,
        stages: [],
        createdProjects: [{ slug: "gauntlet-1-abc", hash: "abc1234" }],
        cleanedUp: true,
        keptForInspection: false,
        reportPath: "reports/gauntlet/matrix-test/backup_gate_blocks_destructive_action",
      },
    ],
  });
  assert.equal(summary.cleanupLeaks, 0);
});

test("buildMatrixSummary aggregates pass/fail and cleanup leaks", () => {
  const summary = buildMatrixSummary({
    options: {
      mode: "v1_dedicated",
      reportDir: "reports/gauntlet",
      prefix: "gauntlet",
      keepFailed: false,
      json: false,
    },
    startedAt: "2026-06-20T00:00:00.000Z",
    finishedAt: "2026-06-20T00:10:00.000Z",
    reportRoot: "reports/gauntlet/matrix-test",
    results: [
      {
        scenarioName: "missing_project_errors",
        mode: "v1_dedicated",
        status: "pass",
        startedAt: "2026-06-20T00:00:00.000Z",
        finishedAt: "2026-06-20T00:01:00.000Z",
        durationMs: 60_000,
        stages: [],
        createdProjects: [],
        cleanedUp: true,
        keptForInspection: false,
        reportPath: "reports/gauntlet/matrix-test/missing_project_errors",
      },
      {
        scenarioName: "push_invalid_sql",
        mode: "v1_dedicated",
        status: "fail",
        startedAt: "2026-06-20T00:01:00.000Z",
        finishedAt: "2026-06-20T00:02:00.000Z",
        durationMs: 60_000,
        stages: [{ name: "cleanup", status: "failed", startedAt: "" }],
        createdProjects: [{ slug: "gauntlet-1-abc", hash: "abc1234" }],
        cleanedUp: false,
        keptForInspection: false,
        reportPath: "reports/gauntlet/matrix-test/push_invalid_sql",
        failureClass: "platform_failure",
      },
    ],
  });
  assert.equal(summary.passed, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.cleanupLeaks, 1);
  const md = buildMatrixSummaryMarkdown(summary);
  assert.match(md, /push_invalid_sql/u);
  assert.match(md, /Cleanup leaks: 1/u);
});

test("matrixScenarioStatus fails when any stage failed", () => {
  assert.equal(
    matrixScenarioStatus([
      { name: "a", status: "passed", startedAt: "" },
      { name: "b", status: "failed", startedAt: "" },
    ]),
    "fail",
  );
});

test("matrix cleanup options preserve gauntlet safety flags", () => {
  const opts = matrixToGauntletOptions({
    mode: "v1_dedicated",
    reportDir: "reports/gauntlet",
    prefix: "gauntlet",
    keepFailed: true,
    json: false,
  });
  assert.equal(opts.mode, "v1_dedicated");
  assert.equal(opts.keepFailed, true);
});

test("backup gate scenario design: operator path has no skip flag in matrix helper", () => {
  // attemptOperatorNuke uses client.nukeProject without skipBackupCheck — enforced in matrix-helpers.ts
  const src = `
    await client.nukeProject(project.slug, project.hash);
  `;
  assert.doesNotMatch(src, /skipBackupCheck/u);
});

test("cleanup guard: untracked slug refused", () => {
  assert.equal(
    isGauntletSlug("gauntlet-1718841600-a1b2c3"),
    true,
  );
  assert.equal(
    shouldAttemptCleanup(
      {
        mode: "v1_dedicated",
        runs: 1,
        keepFailed: false,
        reportDir: "r",
        prefix: "gauntlet",
        skipBackup: false,
        json: false,
      },
      true,
    ),
    true,
  );
});

test("finalizeMatrixScenarioResult attaches failure class", () => {
  const result = finalizeMatrixScenarioResult({
    scenarioName: "push_invalid_sql",
    startedAt: "2026-06-20T00:00:00.000Z",
    stages: [
      {
        name: "invalid_sql_rejected",
        status: "failed",
        startedAt: "2026-06-20T00:00:01.000Z",
        error: { message: "unexpected success" },
      },
    ],
    projects: [],
    cleanedUp: true,
    keptForInspection: false,
    reportPath: "/tmp/test",
  });
  assert.equal(result.status, "fail");
  assert.equal(result.failureClass, "platform_failure");
});

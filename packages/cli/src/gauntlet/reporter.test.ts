import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMarkdownReport,
  createStageRecord,
  deriveFailureAnalysis,
  markStageFailed,
  markStagePassed,
  markStageRunning,
  markStageSkipped,
  overallRunStatus,
} from "./reporter";
import type { GauntletRunResult, StageRecord } from "./types";

test("stage status transitions", () => {
  const stage = createStageRecord("preflight");
  assert.equal(stage.status, "pending");
  markStageRunning(stage);
  assert.equal(stage.status, "running");
  markStagePassed(stage, "ok");
  assert.equal(stage.status, "passed");
  assert.equal(stage.summary, "ok");
  assert.ok(stage.durationMs !== undefined && stage.durationMs >= 0);

  const fail = createStageRecord("push_schema");
  markStageRunning(fail);
  markStageFailed(fail, new Error("boom"));
  assert.equal(fail.status, "failed");
  assert.equal(fail.error?.message, "boom");

  const skip = createStageRecord("backup_verify");
  markStageSkipped(skip, "not supported");
  assert.equal(skip.status, "skipped");
  assert.equal(skip.summary, "not supported");
});

test("overallRunStatus ignores cleanup stages for pass/fail", () => {
  const stages: StageRecord[] = [
    { name: "preflight", status: "passed", startedAt: new Date().toISOString() },
    { name: "delete_project", status: "failed", startedAt: new Date().toISOString() },
  ];
  assert.equal(overallRunStatus(stages), "pass");
});

test("buildMarkdownReport includes timeline and cleanup", () => {
  const stages = [
    {
      name: "preflight" as const,
      status: "passed" as const,
      startedAt: "2026-06-19T21:30:00.000Z",
      durationMs: 120,
      summary: "Docker reachable",
    },
    {
      name: "backup_verify" as const,
      status: "failed" as const,
      startedAt: "2026-06-19T21:30:20.000Z",
      durationMs: 4800,
      error: { message: "Restore verification failed" },
    },
  ];

  const failureAnalysis = deriveFailureAnalysis(stages);
  const result: GauntletRunResult = {
    runId: "2026-06-19T21-30-00Z-gauntlet-ab3f",
    status: "fail",
    mode: "v1_dedicated",
    projectSlug: "gauntlet-1718841600-ab3f",
    projectHash: "abc1234",
    apiUrl: "https://api--gauntlet--abc1234.example.com",
    startedAt: "2026-06-19T21:30:00.000Z",
    finishedAt: "2026-06-19T21:30:30.000Z",
    durationMs: 30_000,
    stages,
    cleanedUp: true,
    keptForInspection: false,
    reportPath: "reports/gauntlet/test",
    commandManifest: {
      command: "flux gauntlet run",
      argv: ["flux", "gauntlet", "run"],
      options: {
        mode: "v1_dedicated",
        runs: 1,
        keepFailed: false,
        reportDir: "reports/gauntlet",
        prefix: "gauntlet",
        skipBackup: false,
        json: false,
      },
      startedAt: "2026-06-19T21:30:00.000Z",
    },
    ...(failureAnalysis !== undefined ? { failureAnalysis } : {}),
    failureClass: "platform_failure",
    failureClassDetail:
      "v1_dedicated failed at backup_verify: Restore verification failed",
  };

  const md = buildMarkdownReport(result);
  assert.match(md, /Result: FAIL/u);
  assert.match(md, /preflight/u);
  assert.match(md, /backup_verify/u);
  assert.match(md, /Deleted project: yes/u);
  assert.match(md, /Failure Analysis/u);
  assert.match(md, /Failure Classification/u);
  assert.match(md, /platform_failure/u);
});

import type { MatrixStageRecord } from "./matrix-types";

export function createMatrixStage(name: string): MatrixStageRecord {
  return {
    name,
    status: "pending",
    startedAt: new Date().toISOString(),
  };
}

export function markMatrixStageRunning(stage: MatrixStageRecord): void {
  stage.status = "running";
  stage.startedAt = new Date().toISOString();
}

export function markMatrixStagePassed(
  stage: MatrixStageRecord,
  summary?: string,
  artifacts?: Record<string, unknown>,
): void {
  const finishedAt = new Date().toISOString();
  stage.status = "passed";
  stage.finishedAt = finishedAt;
  stage.durationMs = Date.parse(finishedAt) - Date.parse(stage.startedAt);
  if (summary !== undefined) stage.summary = summary;
  if (artifacts !== undefined) stage.artifacts = artifacts;
}

export function markMatrixStageFailed(
  stage: MatrixStageRecord,
  err: unknown,
): void {
  const finishedAt = new Date().toISOString();
  stage.status = "failed";
  stage.finishedAt = finishedAt;
  stage.durationMs = Date.parse(finishedAt) - Date.parse(stage.startedAt);
  stage.error = {
    message: err instanceof Error ? err.message : String(err),
    ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
  };
}

export function markMatrixStageSkipped(
  stage: MatrixStageRecord,
  reason: string,
): void {
  const finishedAt = new Date().toISOString();
  stage.status = "skipped";
  stage.finishedAt = finishedAt;
  stage.durationMs = Date.parse(finishedAt) - Date.parse(stage.startedAt);
  stage.summary = reason;
}

export function matrixScenarioStatus(
  stages: MatrixStageRecord[],
): "pass" | "fail" {
  return stages.some((s) => s.status === "failed") ? "fail" : "pass";
}

export function deriveMatrixFailureAnalysis(
  stages: MatrixStageRecord[],
): string | undefined {
  const failed = stages.find((s) => s.status === "failed");
  if (!failed) return undefined;
  return `Failure at ${failed.name}: ${failed.error?.message ?? failed.summary ?? "unknown"}`;
}

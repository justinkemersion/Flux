import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { injectSchemaInspectionMarkdown } from "./schema-story-report";
import type {
  GauntletCommandManifest,
  GauntletProjectCtx,
  GauntletRunResult,
  GauntletStageName,
  StageRecord,
} from "./types";

export function createStageRecord(name: GauntletStageName): StageRecord {
  return {
    name,
    status: "pending",
    startedAt: new Date().toISOString(),
  };
}

export function markStageRunning(stage: StageRecord): void {
  stage.status = "running";
  stage.startedAt = new Date().toISOString();
}

export function markStagePassed(
  stage: StageRecord,
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

export function markStageFailed(stage: StageRecord, err: unknown): void {
  const finishedAt = new Date().toISOString();
  stage.status = "failed";
  stage.finishedAt = finishedAt;
  stage.durationMs = Date.parse(finishedAt) - Date.parse(stage.startedAt);
  stage.error = {
    message: err instanceof Error ? err.message : String(err),
    ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
  };
}

export function markStageSkipped(stage: StageRecord, reason: string): void {
  const finishedAt = new Date().toISOString();
  stage.status = "skipped";
  stage.finishedAt = finishedAt;
  stage.durationMs = Date.parse(finishedAt) - Date.parse(stage.startedAt);
  stage.summary = reason;
}

export function formatDurationMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${String(Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function deriveFailureAnalysis(stages: StageRecord[]): string | undefined {
  const failed = stages.find((s) => s.status === "failed");
  if (!failed) return undefined;
  const idx = stages.findIndex((s) => s.name === failed.name);
  const prior = idx > 0 ? stages[idx - 1] : undefined;
  if (prior?.status === "passed") {
    return `Failure at ${failed.name} immediately after ${prior.name} passed — inspect ${failed.name} logs and artifacts first.`;
  }
  return `Failure at ${failed.name}: ${failed.error?.message ?? failed.summary ?? "unknown error"}`;
}

export function buildMarkdownReport(result: GauntletRunResult): string {
  const lines: string[] = [];
  lines.push("# Flux Gauntlet Report");
  lines.push("");
  lines.push(`Result: ${result.status === "pass" ? "PASS" : "FAIL"}`);
  lines.push(`Mode: ${result.mode}`);
  lines.push(`Project: ${result.projectSlug}`);
  if (result.projectHash) lines.push(`Hash: ${result.projectHash}`);
  if (result.apiUrl) lines.push(`API: ${result.apiUrl}`);
  lines.push(`Started: ${result.startedAt}`);
  lines.push(`Finished: ${result.finishedAt}`);
  lines.push(`Duration: ${formatDurationMs(result.durationMs)}`);
  lines.push("");
  lines.push("## Timeline");
  lines.push("");
  lines.push("| Stage | Status | Duration | Summary |");
  lines.push("|---|---|---:|---|");
  for (const stage of result.stages) {
    const summary =
      stage.summary ??
      stage.error?.message ??
      (stage.status === "skipped" ? "skipped" : "");
    lines.push(
      `| ${stage.name} | ${stage.status} | ${formatDurationMs(stage.durationMs)} | ${summary.replace(/\|/g, "\\|")} |`,
    );
  }
  lines.push("");

  if (result.failureClass) {
    lines.push("## Failure Classification");
    lines.push("");
    lines.push(`Class: \`${result.failureClass}\``);
    if (result.failureClassDetail) {
      lines.push("");
      lines.push(result.failureClassDetail);
    }
    lines.push("");
  }

  if (result.failureAnalysis) {
    lines.push("## Failure Analysis");
    lines.push("");
    lines.push(`Likely weak point:`);
    lines.push(result.failureAnalysis);
    lines.push("");
  }

  lines.push("## Cleanup");
  lines.push("");
  lines.push(`Deleted project: ${result.cleanedUp ? "yes" : "no"}`);
  if (result.keptForInspection) {
    lines.push(`Kept for inspection (--keep-failed): yes`);
    if (result.apiUrl) lines.push(`Inspect API: ${result.apiUrl}`);
  }
  if (result.cleanupError) {
    lines.push("");
    lines.push("**Cleanup failed — manual action required:**");
    lines.push(result.cleanupError);
  }
  if (!result.cleanedUp && !result.keptForInspection && result.projectHash) {
    lines.push("");
    lines.push("Remaining resources:");
    lines.push(
      `- Project slug \`${result.projectSlug}\` hash \`${result.projectHash}\``,
    );
    if (result.apiUrl) lines.push(`- API URL: ${result.apiUrl}`);
  }
  lines.push("");
  return lines.join("\n");
}

export interface WriteReportInput {
  reportRoot: string;
  runId: string;
  result: GauntletRunResult;
  commandManifest: GauntletCommandManifest;
  project?: GauntletProjectCtx;
  stdoutLog: string;
  stderrLog: string;
}

export async function writeGauntletReport(
  input: WriteReportInput,
): Promise<string> {
  const reportPath = join(input.reportRoot, input.runId);
  await mkdir(reportPath, { recursive: true });

  await writeFile(
    join(reportPath, "report.json"),
    `${JSON.stringify(input.result, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(reportPath, "report.md"),
    input.project?.schemaInspection
      ? injectSchemaInspectionMarkdown(
          buildMarkdownReport(input.result),
          input.project.schemaInspection,
        )
      : buildMarkdownReport(input.result),
    "utf8",
  );
  await writeFile(join(reportPath, "stdout.log"), input.stdoutLog, "utf8");
  await writeFile(join(reportPath, "stderr.log"), input.stderrLog, "utf8");
  await writeFile(
    join(reportPath, "command-manifest.json"),
    `${JSON.stringify(input.commandManifest, null, 2)}\n`,
    "utf8",
  );

  if (input.project?.openapiSnapshot !== undefined) {
    await writeFile(
      join(reportPath, "schema-introspection.json"),
      `${JSON.stringify(input.project.openapiSnapshot, null, 2)}\n`,
      "utf8",
    );
  }
  if (input.project?.projectSummaryBefore !== undefined) {
    await writeFile(
      join(reportPath, "project-summary-before.json"),
      `${JSON.stringify(input.project.projectSummaryBefore, null, 2)}\n`,
      "utf8",
    );
  }

  if (input.result.cleanedUp) {
    await writeFile(
      join(reportPath, "project-summary-after.json"),
      JSON.stringify({ absentFromCatalog: true, slug: input.result.projectSlug }, null, 2) + "\n",
      "utf8",
    );
  }

  return reportPath;
}

export function overallRunStatus(stages: StageRecord[]): "pass" | "fail" {
  const validationStages = stages.filter(
    (s) => s.name !== "delete_project" && s.name !== "post_cleanup_verify",
  );
  return validationStages.some((s) => s.status === "failed") ? "fail" : "pass";
}

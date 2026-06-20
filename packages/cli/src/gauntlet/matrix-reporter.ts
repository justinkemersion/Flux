import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { classifyGauntletFailure } from "./failure-class";
import { formatDurationMs } from "./reporter";
import {
  deriveMatrixFailureAnalysis,
  matrixScenarioStatus,
} from "./matrix-stage";
import type {
  MatrixCommandManifest,
  MatrixRunOptions,
  MatrixScenarioResult,
  MatrixSummary,
} from "./matrix-types";
import type { StageRecord } from "./types";

export function buildMatrixScenarioMarkdown(
  result: MatrixScenarioResult,
): string {
  const lines: string[] = [];
  lines.push(`# Flux Gauntlet Matrix — ${result.scenarioName}`);
  lines.push("");
  lines.push(`Result: ${result.status === "pass" ? "PASS" : result.status === "fail" ? "FAIL" : "SKIPPED"}`);
  lines.push(`Mode: ${result.mode}`);
  lines.push(`Duration: ${formatDurationMs(result.durationMs)}`);
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

  if (result.failureAnalysis) {
    lines.push("## Failure Analysis");
    lines.push("");
    lines.push(result.failureAnalysis);
    lines.push("");
  }

  lines.push("## Cleanup");
  lines.push("");
  lines.push(`Deleted project: ${result.cleanedUp ? "yes" : "no"}`);
  if (result.cleanupError) {
    lines.push("");
    lines.push(`**Cleanup error:** ${result.cleanupError}`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function writeMatrixScenarioReport(input: {
  result: MatrixScenarioResult;
  commandManifest: MatrixCommandManifest;
}): Promise<void> {
  const dir = input.result.reportPath;
  await mkdir(dir, { recursive: true });

  await writeFile(
    join(dir, "report.json"),
    `${JSON.stringify(input.result, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(dir, "report.md"),
    buildMatrixScenarioMarkdown(input.result),
    "utf8",
  );
  await writeFile(
    join(dir, "command-manifest.json"),
    `${JSON.stringify(input.commandManifest, null, 2)}\n`,
    "utf8",
  );
}

export function buildMatrixSummary(input: {
  options: MatrixRunOptions;
  startedAt: string;
  finishedAt: string;
  reportRoot: string;
  results: MatrixScenarioResult[];
}): MatrixSummary {
  const durationMs =
    Date.parse(input.finishedAt) - Date.parse(input.startedAt);
  const passed = input.results.filter((r) => r.status === "pass").length;
  const failed = input.results.filter((r) => r.status === "fail").length;
  const skipped = input.results.filter((r) => r.status === "skipped").length;
  const cleanupLeaks = input.results.filter(
    (r) =>
      r.createdProjects.length > 0 &&
      !r.cleanedUp &&
      !r.keptForInspection &&
      r.status !== "skipped",
  ).length;

  return {
    ring: "ring_2_matrix_lite",
    mode: "v1_dedicated",
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs,
    totalScenarios: input.results.length,
    passed,
    failed,
    skipped,
    cleanupLeaks,
    reportRoot: input.reportRoot,
    scenarios: input.results.map((r) => ({
      name: r.scenarioName,
      status: r.status,
      durationMs: r.durationMs,
      ...(r.failureClass ? { failureClass: r.failureClass } : {}),
      reportPath: r.reportPath,
    })),
  };
}

export function buildMatrixSummaryMarkdown(summary: MatrixSummary): string {
  const lines: string[] = [];
  lines.push("# Flux Gauntlet Matrix Summary");
  lines.push("");
  lines.push(`Ring: ${summary.ring}`);
  lines.push(`Mode: ${summary.mode}`);
  lines.push(`Total: ${String(summary.totalScenarios)}`);
  lines.push(`Passed: ${String(summary.passed)}`);
  lines.push(`Failed: ${String(summary.failed)}`);
  lines.push(`Skipped: ${String(summary.skipped)}`);
  lines.push(`Cleanup leaks: ${String(summary.cleanupLeaks)}`);
  lines.push(`Duration: ${formatDurationMs(summary.durationMs)}`);
  lines.push("");
  lines.push("| Scenario | Status | Duration | Failure class |");
  lines.push("|---|---|---:|---|");
  for (const s of summary.scenarios) {
    lines.push(
      `| ${s.name} | ${s.status} | ${formatDurationMs(s.durationMs)} | ${s.failureClass ?? "-"} |`,
    );
  }
  lines.push("");
  if (summary.failed === 0 && summary.cleanupLeaks === 0) {
    lines.push("Decision: **Ring 2 matrix batch complete**");
  } else {
    lines.push("Decision: **Review failed scenarios before expanding**");
  }
  lines.push("");
  return lines.join("\n");
}

export async function writeMatrixSummaryReports(input: {
  reportRoot: string;
  summary: MatrixSummary;
}): Promise<void> {
  await mkdir(input.reportRoot, { recursive: true });
  await writeFile(
    join(input.reportRoot, "matrix-summary.json"),
    `${JSON.stringify(input.summary, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(input.reportRoot, "matrix-summary.md"),
    buildMatrixSummaryMarkdown(input.summary),
    "utf8",
  );
}

export function finalizeMatrixScenarioResult(input: {
  scenarioName: MatrixScenarioResult["scenarioName"];
  startedAt: string;
  stages: MatrixScenarioResult["stages"];
  projects: MatrixScenarioResult["createdProjects"];
  cleanedUp: boolean;
  cleanupError?: string;
  keptForInspection: boolean;
  reportPath: string;
  artifacts?: Record<string, unknown>;
}): MatrixScenarioResult {
  const finishedAt = new Date().toISOString();
  const durationMs = Date.parse(finishedAt) - Date.parse(input.startedAt);
  const status = matrixScenarioStatus(input.stages);
  const failureAnalysis = deriveMatrixFailureAnalysis(input.stages);
  const classification = classifyGauntletFailure({
    mode: "v1_dedicated",
    stages: input.stages as unknown as StageRecord[],
    status: status === "pass" ? "pass" : "fail",
  });

  return {
    scenarioName: input.scenarioName,
    mode: "v1_dedicated",
    status,
    startedAt: input.startedAt,
    finishedAt,
    durationMs,
    stages: input.stages,
    createdProjects: input.projects,
    cleanedUp: input.cleanedUp,
    ...(input.cleanupError ? { cleanupError: input.cleanupError } : {}),
    keptForInspection: input.keptForInspection,
    reportPath: input.reportPath,
    ...(failureAnalysis ? { failureAnalysis } : {}),
    ...(classification?.failureClass
      ? { failureClass: classification.failureClass }
      : {}),
    ...(classification?.failureClassDetail
      ? { failureClassDetail: classification.failureClassDetail }
      : {}),
    ...(input.artifacts ? { artifacts: input.artifacts } : {}),
  };
}

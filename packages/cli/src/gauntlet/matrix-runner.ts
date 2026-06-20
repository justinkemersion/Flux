import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import type { GauntletLogger } from "./runner";
import {
  createMatrixStage,
  markMatrixStageFailed,
  markMatrixStagePassed,
  markMatrixStageRunning,
} from "./matrix-stage";
import {
  buildMatrixSummary,
  finalizeMatrixScenarioResult,
  writeMatrixScenarioReport,
  writeMatrixSummaryReports,
} from "./matrix-reporter";
import { MATRIX_SCENARIOS } from "./matrix-scenarios";
import type { MatrixScenarioContext } from "./matrix-scenarios";
import type {
  MatrixCommandManifest,
  MatrixRunOptions,
  MatrixScenarioName,
  MatrixScenarioResult,
} from "./matrix-types";
import { resolveMatrixScenarioNames } from "./matrix-types";

export interface RunGauntletMatrixInput {
  options: MatrixRunOptions;
  argv: string[];
  logger?: GauntletLogger;
  createdProjectSlugs?: Set<string>;
}

const defaultLogger: GauntletLogger = {
  log: (line) => console.log(line),
  error: (line) => console.error(line),
};

function stageIcon(status: string): string {
  if (status === "passed") return chalk.green("✓");
  if (status === "failed") return chalk.red("✗");
  if (status === "skipped") return chalk.yellow("○");
  return chalk.dim("·");
}

function formatStageDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "";
  if (ms < 1000) return `${String(Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

async function runScenarioStage(
  ctx: MatrixScenarioContext,
  name: string,
  fn: () => Promise<void>,
  logger: GauntletLogger,
): Promise<boolean> {
  const stage = createMatrixStage(name);
  ctx.stages.push(stage);
  markMatrixStageRunning(stage);
  try {
    await fn();
    if (stage.status === "running") {
      markMatrixStagePassed(stage, stage.summary);
    }
    logger.log(
      `  ${stageIcon("passed")} ${name}${stage.durationMs !== undefined ? chalk.dim(`  ${formatStageDuration(stage.durationMs)}`) : ""}${stage.summary ? chalk.dim(`  ${stage.summary}`) : ""}`,
    );
    return true;
  } catch (err: unknown) {
    markMatrixStageFailed(stage, err);
    logger.log(
      `  ${stageIcon("failed")} ${name}${stage.durationMs !== undefined ? chalk.dim(`  ${formatStageDuration(stage.durationMs)}`) : ""}  ${chalk.red(stage.error?.message ?? "failed")}`,
    );
    return false;
  }
}

async function runSingleScenario(input: {
  name: MatrixScenarioName;
  options: MatrixRunOptions;
  reportRoot: string;
  createdProjectSlugs: Set<string>;
  commandManifest: MatrixCommandManifest;
  logger: GauntletLogger;
}): Promise<MatrixScenarioResult> {
  const startedAt = new Date().toISOString();
  const reportPath = join(input.reportRoot, input.name);
  await mkdir(reportPath, { recursive: true });

  const stages: MatrixScenarioContext["stages"] = [];
  const projects: MatrixScenarioContext["projects"] = [];
  const artifacts: Record<string, unknown> = {};

  const ctx: MatrixScenarioContext = {
    options: input.options,
    reportDir: reportPath,
    createdProjectSlugs: input.createdProjectSlugs,
    stages,
    projects,
    artifacts,
    runStage: (name, fn) => runScenarioStage(ctx, name, fn, input.logger),
  };

  const def = MATRIX_SCENARIOS[input.name];
  await def.run(ctx);

  const scenarioFailed = stages.some((s) => s.status === "failed");
  const lastCleanup = artifacts.cleanup as
    | { cleanedUp?: boolean; cleanupError?: string }
    | undefined;
  const verifyAbsentPassed = stages.some(
    (s) => s.name === "verify_absent" && s.status === "passed",
  );
  const cleanedUp =
    projects.length === 0
      ? true
      : lastCleanup?.cleanedUp === true ||
        (verifyAbsentPassed && !scenarioFailed);
  const cleanupError =
    typeof lastCleanup?.cleanupError === "string"
      ? lastCleanup.cleanupError
      : undefined;

  const result = finalizeMatrixScenarioResult({
    scenarioName: input.name,
    startedAt,
    stages,
    projects: projects.map((p) => ({ slug: p.slug, hash: p.hash })),
    cleanedUp,
    ...(cleanupError ? { cleanupError } : {}),
    keptForInspection: input.options.keepFailed && scenarioFailed,
    reportPath,
    artifacts,
  });

  try {
    await writeMatrixScenarioReport({
      result,
      commandManifest: {
        ...input.commandManifest,
        options: {
          ...input.options,
          scenario: input.name,
        },
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    input.logger.error(
      chalk.red(`Report write failed for ${input.name}: ${msg}`),
    );
  }

  return result;
}

export async function runGauntletMatrix(
  input: RunGauntletMatrixInput,
): Promise<{ results: MatrixScenarioResult[]; summaryPath: string }> {
  const logger = input.logger ?? defaultLogger;
  const startedAt = new Date().toISOString();
  const batchId = startedAt.replace(/[:.]/g, "-");
  const reportRoot = join(input.options.reportDir, `matrix-${batchId}`);
  const createdProjectSlugs = input.createdProjectSlugs ?? new Set<string>();

  const scenarioNames = resolveMatrixScenarioNames(input.options.scenario);

  const commandManifest: MatrixCommandManifest = {
    command: "flux gauntlet matrix",
    argv: input.argv,
    options: input.options,
    startedAt,
  };

  logger.log(chalk.bold("Flux Gauntlet Matrix"));
  logger.log(`Mode: ${input.options.mode}`);
  logger.log(`Scenarios: ${String(scenarioNames.length)}`);
  logger.log("");

  const results: MatrixScenarioResult[] = [];

  for (let i = 0; i < scenarioNames.length; i++) {
    const name = scenarioNames[i]!;
    logger.log(`[${String(i + 1)}/${String(scenarioNames.length)}] ${name}`);
    const result = await runSingleScenario({
      name,
      options: input.options,
      reportRoot,
      createdProjectSlugs,
      commandManifest,
      logger,
    });
    results.push(result);
    logger.log("");
  }

  const finishedAt = new Date().toISOString();
  const summary = buildMatrixSummary({
    options: input.options,
    startedAt,
    finishedAt,
    reportRoot,
    results,
  });

  await writeMatrixSummaryReports({ reportRoot, summary });

  const passed = summary.passed;
  const failed = summary.failed;
  const skipped = summary.skipped;
  logger.log("Summary:");
  logger.log(
    chalk.white(
      `${String(passed)} passed, ${String(failed)} failed, ${String(skipped)} skipped`,
    ),
  );
  if (summary.cleanupLeaks > 0) {
    logger.log(chalk.red(`Cleanup leaks: ${String(summary.cleanupLeaks)}`));
  }
  logger.log("");
  logger.log(`Report: ${reportRoot}`);

  return { results, summaryPath: reportRoot };
}

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { generateGauntletProjectName, formatRunId } from "./names";
import {
  safeDeleteGauntletProject,
  shouldAttemptCleanup,
} from "./cleanup";
import {
  createStageRecord,
  deriveFailureAnalysis,
  markStageFailed,
  markStagePassed,
  markStageRunning,
  markStageSkipped,
  overallRunStatus,
  writeGauntletReport,
} from "./reporter";
import { classifyGauntletFailure } from "./failure-class";
import { STAGE_EXECUTORS } from "./stages";
import { GauntletStageSkip } from "./types";
import type {
  GauntletCommandManifest,
  GauntletRunOptions,
  GauntletRunResult,
  GauntletRunnerState,
  GauntletStageName,
} from "./types";
import { GAUNTLET_STAGE_ORDER } from "./types";

export interface GauntletLogger {
  log(line: string): void;
  error(line: string): void;
}

export interface RunGauntletInput {
  options: GauntletRunOptions;
  argv: string[];
  logger?: GauntletLogger;
  /** Shared across --runs iterations in one process. */
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

function schemaDependentStageSkipped(state: GauntletRunnerState): string | undefined {
  const push = state.stages.find((s) => s.name === "push_schema");
  if (push?.status === "skipped") {
    return "push_schema was skipped";
  }
  if (push?.status === "failed") {
    return "push_schema failed";
  }
  if (!state.project?.schemaSqlPath) {
    return "schema not pushed";
  }
  return undefined;
}

async function runSingleStage(
  state: GauntletRunnerState,
  name: GauntletStageName,
  logger: GauntletLogger,
): Promise<boolean> {
  const dependentSkip = [
    "inspect_schema",
    "inspect_schema_deep",
    "api_insert",
    "api_select",
  ] as const;
  if (
    (dependentSkip as readonly string[]).includes(name) &&
    schemaDependentStageSkipped(state)
  ) {
    const stage = createStageRecord(name);
    state.stages.push(stage);
    const reason = schemaDependentStageSkipped(state) ?? "schema unavailable";
    markStageSkipped(stage, reason);
    logger.log(
      `  ${stageIcon("skipped")} ${name}  ${chalk.dim(reason)}`,
    );
    return true;
  }

  const stage = createStageRecord(name);
  state.stages.push(stage);
  markStageRunning(stage);

  try {
    await STAGE_EXECUTORS[name](state, stage);
    if (stage.status === "running") {
      markStagePassed(stage, stage.summary);
    }
    logger.log(
      `  ${stageIcon("passed")} ${name}${stage.durationMs !== undefined ? chalk.dim(`  ${formatStageDuration(stage.durationMs)}`) : ""}${stage.summary ? chalk.dim(`  ${stage.summary}`) : ""}`,
    );
    return true;
  } catch (err: unknown) {
    if (err instanceof GauntletStageSkip) {
      markStageSkipped(stage, err.reason);
      logger.log(
        `  ${stageIcon("skipped")} ${name}${stage.durationMs !== undefined ? chalk.dim(`  ${formatStageDuration(stage.durationMs)}`) : ""}  ${chalk.dim(err.reason)}`,
      );
      return true;
    }
    markStageFailed(stage, err);
    logger.log(
      `  ${stageIcon("failed")} ${name}${stage.durationMs !== undefined ? chalk.dim(`  ${formatStageDuration(stage.durationMs)}`) : ""}  ${chalk.red(stage.error?.message ?? "failed")}`,
    );
    return false;
  }
}

function formatStageDuration(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

async function finalizeCleanup(
  state: GauntletRunnerState,
  runFailed: boolean,
): Promise<{ cleanedUp: boolean; cleanupError?: string; keptForInspection: boolean }> {
  const project = state.project;
  if (!project) {
    return { cleanedUp: false, keptForInspection: false };
  }

  const keptForInspection = state.options.keepFailed && runFailed;
  if (!shouldAttemptCleanup(state.options, runFailed)) {
    return { cleanedUp: false, keptForInspection };
  }

  const deleteStage = state.stages.find((s) => s.name === "delete_project");
  try {
    const result = await safeDeleteGauntletProject({
      project,
      options: state.options,
      createdProjectSlugs: state.createdProjectSlugs,
    });
    if (deleteStage) {
      if (result.skipped) {
        markStageSkipped(deleteStage, result.reason ?? "delete skipped");
      } else {
        markStagePassed(deleteStage, "Project deleted");
      }
    }
    if (result.skipped) {
      return {
        cleanedUp: false,
        ...(result.reason ? { cleanupError: result.reason } : {}),
        keptForInspection: false,
      };
    }
    return { cleanedUp: true, keptForInspection: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (deleteStage) {
      markStageFailed(deleteStage, err);
    }
    return {
      cleanedUp: false,
      cleanupError: `Cleanup failed for ${project.slug} (#${project.hash}): ${msg}. Manual: flux nuke ${project.slug} --hash ${project.hash} --skip-backup-check -y`,
      keptForInspection: false,
    };
  }
}

export async function runSingleGauntlet(
  input: RunGauntletInput,
): Promise<GauntletRunResult> {
  const logger = input.logger ?? defaultLogger;
  const runStartedAt = new Date().toISOString();
  const projectName = generateGauntletProjectName(input.options.prefix);
  const runId = formatRunId(runStartedAt, projectName);
  const reportDir = join(input.options.reportDir, runId);

  await mkdir(reportDir, { recursive: true });

  const commandManifest: GauntletCommandManifest = {
    command: "flux gauntlet run",
    argv: input.argv,
    options: input.options,
    startedAt: runStartedAt,
  };

  const state: GauntletRunnerState = {
    options: input.options,
    createdProjectSlugs: input.createdProjectSlugs ?? new Set<string>(),
    stages: [],
    runStartedAt,
    commandManifest,
    pendingCreate: { requestedName: projectName, reportDir },
  };

  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const captureLogger: GauntletLogger = {
    log: (line) => {
      stdoutLines.push(line);
      logger.log(line);
    },
    error: (line) => {
      stderrLines.push(line);
      logger.error(line);
    },
  };

  captureLogger.log(`[1/1] ${projectName}`);

  let abortRemaining = false;
  for (const name of GAUNTLET_STAGE_ORDER) {
    if (name === "delete_project" || name === "post_cleanup_verify") {
      continue;
    }

    const ok = await runSingleStage(state, name, captureLogger);
    if (!ok && name !== "preflight") {
      abortRemaining = true;
      break;
    }
    if (!ok && name === "preflight") {
      abortRemaining = true;
      break;
    }
  }

  const validationFailed =
    abortRemaining || overallRunStatus(state.stages) === "fail";

  // Mark skipped stages after early abort
  if (abortRemaining) {
    const ran = new Set(state.stages.map((s) => s.name));
    for (const name of GAUNTLET_STAGE_ORDER) {
      if (ran.has(name)) continue;
      if (name === "delete_project" || name === "post_cleanup_verify") continue;
      const stage = createStageRecord(name);
      markStageSkipped(stage, "Earlier stage failed");
      state.stages.push(stage);
    }
  }

  const deleteStage = createStageRecord("delete_project");
  state.stages.push(deleteStage);
  markStageRunning(deleteStage);

  const cleanup = await finalizeCleanup(state, validationFailed);

  if (!state.options.keepFailed || !validationFailed) {
    const verifyStage = createStageRecord("post_cleanup_verify");
    state.stages.push(verifyStage);
    markStageRunning(verifyStage);
    if (cleanup.cleanedUp) {
      try {
        await STAGE_EXECUTORS.post_cleanup_verify(state, verifyStage);
        if (verifyStage.status === "running") {
          markStagePassed(verifyStage, verifyStage.summary);
        }
        captureLogger.log(
          `  ${stageIcon("passed")} post_cleanup_verify  ${verifyStage.summary ?? ""}`,
        );
      } catch (err: unknown) {
        if (err instanceof GauntletStageSkip) {
          markStageSkipped(verifyStage, err.reason);
          captureLogger.log(
            `  ${stageIcon("skipped")} post_cleanup_verify  ${err.reason}`,
          );
        } else {
          markStageFailed(verifyStage, err);
          captureLogger.log(
            `  ${stageIcon("failed")} post_cleanup_verify  ${verifyStage.error?.message ?? ""}`,
          );
        }
      }
    } else if (cleanup.keptForInspection) {
      markStageSkipped(verifyStage, "Skipped (--keep-failed)");
      captureLogger.log(
        `  ${stageIcon("skipped")} post_cleanup_verify  Skipped (--keep-failed)`,
      );
    } else {
      markStageSkipped(
        verifyStage,
        cleanup.cleanupError ?? "Cleanup did not complete",
      );
      captureLogger.log(
        `  ${stageIcon("skipped")} post_cleanup_verify  ${verifyStage.summary ?? ""}`,
      );
    }
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.parse(finishedAt) - Date.parse(runStartedAt);
  const project = state.project;

  const failureAnalysis = deriveFailureAnalysis(state.stages);
  const classification = classifyGauntletFailure({
    mode: input.options.mode,
    stages: state.stages,
    status: validationFailed ? "fail" : "pass",
  });

  const result: GauntletRunResult = {
    runId,
    status: validationFailed ? "fail" : "pass",
    mode: input.options.mode,
    projectSlug: project?.slug ?? projectName,
    ...(project?.hash ? { projectHash: project.hash } : {}),
    ...(project?.apiUrl ? { apiUrl: project.apiUrl } : {}),
    startedAt: runStartedAt,
    finishedAt,
    durationMs,
    stages: state.stages,
    cleanedUp: cleanup.cleanedUp,
    ...(cleanup.cleanupError ? { cleanupError: cleanup.cleanupError } : {}),
    keptForInspection: cleanup.keptForInspection,
    reportPath: reportDir,
    commandManifest,
    ...(failureAnalysis ? { failureAnalysis } : {}),
    ...(classification?.failureClass
      ? { failureClass: classification.failureClass }
      : {}),
    ...(classification?.failureClassDetail
      ? { failureClassDetail: classification.failureClassDetail }
      : {}),
  };

  // Finalization — never treated as a validation stage.
  try {
    await writeGauntletReport({
      reportRoot: input.options.reportDir,
      runId,
      result,
      commandManifest,
      ...(project ? { project } : {}),
      stdoutLog: `${stdoutLines.join("\n")}\n`,
      stderrLog: `${stderrLines.join("\n")}\n`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    captureLogger.error(
      chalk.red(`Report write failed (run result unchanged): ${msg}`),
    );
  }

  return result;
}

export async function runGauntlet(input: RunGauntletInput): Promise<GauntletRunResult[]> {
  const logger = input.logger ?? defaultLogger;
  const createdProjectSlugs = input.createdProjectSlugs ?? new Set<string>();
  const results: GauntletRunResult[] = [];

  logger.log(chalk.bold("Flux Gauntlet"));
  logger.log(`Mode: ${input.options.mode}`);
  logger.log(`Runs: ${String(input.options.runs)}`);
  logger.log("");

  for (let i = 0; i < input.options.runs; i++) {
    if (input.options.runs > 1) {
      logger.log(chalk.dim(`--- Run ${String(i + 1)}/${String(input.options.runs)} ---`));
    }
    const result = await runSingleGauntlet({
      ...input,
      createdProjectSlugs,
    });
    results.push(result);
    logger.log("");
    logger.log(`Report: ${result.reportPath}`);
    if (result.keptForInspection && result.apiUrl) {
      logger.log(
        chalk.yellow(
          `Kept for inspection: ${result.projectSlug} (#${result.projectHash ?? "?"}) ${result.apiUrl}`,
        ),
      );
    }
    if (result.status === "fail" && !input.options.json) {
      logger.log(chalk.red(`Result: FAIL`));
    } else if (!input.options.json) {
      logger.log(chalk.green(`Result: PASS`));
    }
    logger.log("");
  }

  return results;
}

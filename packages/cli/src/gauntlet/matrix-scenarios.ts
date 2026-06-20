import { getApiClient } from "../api-client";
import type { GauntletProjectCtx } from "./types";
import type { MatrixScenarioName, MatrixRunOptions } from "./matrix-types";
import {
  assertApiHealthy,
  assertProjectAbsent,
  attemptOperatorNuke,
  expectOperationNotFound,
  fakeMissingProject,
  INVALID_SQL_FIXTURE,
  matrixCleanupProject,
  provisionV1GauntletProject,
  pushSqlString,
  pushValidGauntletSchema,
  getProjectStatus,
  verifyGauntletSchemaIntact,
  writeInvalidSqlArtifact,
} from "./matrix-helpers";
import type { MatrixStageRecord } from "./matrix-types";

export interface MatrixScenarioContext {
  options: MatrixRunOptions;
  reportDir: string;
  createdProjectSlugs: Set<string>;
  stages: MatrixStageRecord[];
  projects: GauntletProjectCtx[];
  artifacts: Record<string, unknown>;
  runStage: (
    name: string,
    fn: () => Promise<void>,
  ) => Promise<boolean>;
}

export type MatrixScenarioFn = (ctx: MatrixScenarioContext) => Promise<void>;

async function cleanupAndVerify(
  ctx: MatrixScenarioContext,
  project: GauntletProjectCtx,
  scenarioFailed: boolean,
): Promise<void> {
  await ctx.runStage("cleanup", async () => {
    const result = await matrixCleanupProject({
      project,
      options: ctx.options,
      createdProjectSlugs: ctx.createdProjectSlugs,
      scenarioFailed,
    });
    ctx.artifacts.cleanup = result;
    if (!result.cleanedUp && result.cleanupError) {
      throw new Error(result.cleanupError);
    }
  });

  if (!scenarioFailed && !ctx.options.keepFailed) {
    await ctx.runStage("verify_absent", async () => {
      await assertProjectAbsent(project.slug);
    });
  }
}

export async function scenarioCreateDuplicateProject(
  ctx: MatrixScenarioContext,
): Promise<void> {
  let project!: GauntletProjectCtx;
  let requestedName = "";

  await ctx.runStage("create_project", async () => {
    requestedName = (await import("./names")).generateGauntletProjectName(
      ctx.options.prefix,
    );
    project = await provisionV1GauntletProject({
      options: ctx.options,
      reportDir: ctx.reportDir,
      name: requestedName,
      createdProjectSlugs: ctx.createdProjectSlugs,
    });
    ctx.projects.push(project);
  });

  await ctx.runStage("duplicate_create_rejected", async () => {
    const client = getApiClient();
    try {
      await client.createProject({
        name: requestedName,
        stripSupabaseRestPrefix: true,
        mode: "v1_dedicated",
      });
      throw new Error(
        "Duplicate create succeeded — expected rejection (409 or already exists)",
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const rejected =
        /already have a project|already exists|409|duplicate/i.test(msg);
      if (!rejected) {
        throw new Error(`Duplicate create did not fail as expected: ${msg}`);
      }
      ctx.artifacts.duplicateError = msg.slice(0, 300);
    }
  });

  const failed = ctx.stages.some((s) => s.status === "failed");
  await cleanupAndVerify(ctx, project, failed);
}

export async function scenarioPushInvalidSql(
  ctx: MatrixScenarioContext,
): Promise<void> {
  let project!: GauntletProjectCtx;

  await ctx.runStage("create_project", async () => {
    project = await provisionV1GauntletProject({
      options: ctx.options,
      reportDir: ctx.reportDir,
      createdProjectSlugs: ctx.createdProjectSlugs,
    });
    ctx.projects.push(project);
  });

  await ctx.runStage("push_valid_schema", async () => {
    await pushValidGauntletSchema(project);
  });

  await ctx.runStage("invalid_sql_rejected", async () => {
    const invalidPath = await writeInvalidSqlArtifact(ctx.reportDir);
    ctx.artifacts.invalidSqlPath = invalidPath;
    try {
      await pushSqlString(project, INVALID_SQL_FIXTURE);
      throw new Error("Invalid SQL push succeeded — expected failure");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/expected failure/u.test(msg)) throw err;
      ctx.artifacts.invalidPushError = msg.slice(0, 400);
    }
  });

  await ctx.runStage("api_still_healthy", async () => {
    await assertApiHealthy(project);
  });

  await ctx.runStage("schema_still_intact", async () => {
    const inspection = await verifyGauntletSchemaIntact(project);
    ctx.artifacts.schemaInspection = {
      tableCount: inspection.summary.tableCount,
      tables: inspection.tables.map((t) => t.name),
      warningCount: inspection.warnings.length,
    };
  });

  const failed = ctx.stages.some((s) => s.status === "failed");
  await cleanupAndVerify(ctx, project, failed);
}

export async function scenarioEnvSetAndListRedaction(
  ctx: MatrixScenarioContext,
): Promise<void> {
  let project!: GauntletProjectCtx;
  const publicKey = "PUBLIC_GAUNTLET_VALUE";
  const secretKey = "GAUNTLET_SECRET_TOKEN";

  await ctx.runStage("create_project", async () => {
    project = await provisionV1GauntletProject({
      options: ctx.options,
      reportDir: ctx.reportDir,
      createdProjectSlugs: ctx.createdProjectSlugs,
    });
    ctx.projects.push(project);
  });

  await ctx.runStage("env_set", async () => {
    const client = getApiClient();
    await client.setProjectEnv(
      project.slug,
      {
        [publicKey]: "hello",
        [secretKey]: "super-secret-test-value",
      },
      project.hash,
    );
  });

  await ctx.runStage("env_list_redaction", async () => {
    const client = getApiClient();
    const entries = await client.listProjectEnv(project.slug, project.hash);
    const pub = entries.find((e) => e.key === publicKey);
    const sec = entries.find((e) => e.key === secretKey);
    if (!pub || pub.sensitive !== false || pub.value !== "hello") {
      throw new Error(`Public env key ${publicKey} not visible as expected`);
    }
    if (!sec || sec.sensitive !== true) {
      throw new Error(
        `Sensitive env key ${secretKey} must be listed with sensitive:true and no value`,
      );
    }
    if ("value" in sec && sec.value) {
      throw new Error("Sensitive env value must not be exposed in list");
    }
    ctx.artifacts.envList = entries;
  });

  const failed = ctx.stages.some((s) => s.status === "failed");
  await cleanupAndVerify(ctx, project, failed);
}

export async function scenarioStopStartProject(
  ctx: MatrixScenarioContext,
): Promise<void> {
  let project!: GauntletProjectCtx;
  const client = getApiClient();

  await ctx.runStage("create_project", async () => {
    project = await provisionV1GauntletProject({
      options: ctx.options,
      reportDir: ctx.reportDir,
      createdProjectSlugs: ctx.createdProjectSlugs,
    });
    ctx.projects.push(project);
  });

  await ctx.runStage("wait_for_health", async () => {
    await assertApiHealthy(project);
  });

  await ctx.runStage("stop_project", async () => {
    await client.stopProject(project.slug, project.hash);
    const status = await getProjectStatus(project.hash);
    if (status !== "stopped") {
      throw new Error(`Expected status stopped after stop, got ${status ?? "unknown"}`);
    }
  });

  await ctx.runStage("start_project", async () => {
    await client.startProject(project.slug, project.hash);
    const status = await getProjectStatus(project.hash);
    if (status !== "running" && status !== "partial") {
      throw new Error(`Expected running after start, got ${status ?? "unknown"}`);
    }
  });

  await ctx.runStage("wait_for_health_after_start", async () => {
    await assertApiHealthy(project);
  });

  const failed = ctx.stages.some((s) => s.status === "failed");
  await cleanupAndVerify(ctx, project, failed);
}

export async function scenarioDoubleStopProject(
  ctx: MatrixScenarioContext,
): Promise<void> {
  let project!: GauntletProjectCtx;
  const client = getApiClient();

  await ctx.runStage("create_project", async () => {
    project = await provisionV1GauntletProject({
      options: ctx.options,
      reportDir: ctx.reportDir,
      createdProjectSlugs: ctx.createdProjectSlugs,
    });
    ctx.projects.push(project);
  });

  await ctx.runStage("stop_project", async () => {
    await client.stopProject(project.slug, project.hash);
  });

  await ctx.runStage("stop_project_again", async () => {
    try {
      await client.stopProject(project.slug, project.hash);
      ctx.artifacts.secondStop = "idempotent_success";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const acceptable =
        /already stopped|not running|409|422|400/i.test(msg) ||
        msg.includes("Request failed");
      if (!acceptable) {
        throw new Error(`Second stop unexpected error: ${msg}`);
      }
      ctx.artifacts.secondStop = msg.slice(0, 200);
    }
  });

  await ctx.runStage("start_for_cleanup", async () => {
    await client.startProject(project.slug, project.hash);
  });

  const failed = ctx.stages.some((s) => s.status === "failed");
  await cleanupAndVerify(ctx, project, failed);
}

export async function scenarioMissingProjectErrors(
  ctx: MatrixScenarioContext,
): Promise<void> {
  const missing = fakeMissingProject();
  ctx.artifacts.missingProject = missing;
  const client = getApiClient();

  await ctx.runStage("metadata_not_found", async () => {
    const msg = await expectOperationNotFound("getProjectMetadata", () =>
      client.getProjectMetadata(missing.hash),
    );
    ctx.artifacts.metadataError = msg;
  });

  await ctx.runStage("push_not_found", async () => {
    const msg = await expectOperationNotFound("pushSql", () =>
      client.pushSql({
        slug: missing.slug,
        hash: missing.hash,
        sql: "SELECT 1;",
      }),
    );
    ctx.artifacts.pushError = msg;
  });

  await ctx.runStage("stop_not_found", async () => {
    const msg = await expectOperationNotFound("stopProject", () =>
      client.stopProject(missing.slug, missing.hash),
    );
    ctx.artifacts.stopError = msg;
  });

  await ctx.runStage("env_list_not_found", async () => {
    const msg = await expectOperationNotFound("listProjectEnv", () =>
      client.listProjectEnv(missing.slug, missing.hash),
    );
    ctx.artifacts.envError = msg;
  });

  await ctx.runStage("no_cleanup_needed", async () => {
    // Project was never created — gauntlet must not attempt delete
    if (ctx.createdProjectSlugs.has(missing.slug.toLowerCase())) {
      throw new Error("Missing-project slug incorrectly tracked for cleanup");
    }
  });
}

export async function scenarioBackupGateBlocksDestructive(
  ctx: MatrixScenarioContext,
): Promise<void> {
  let project!: GauntletProjectCtx;
  const client = getApiClient();

  await ctx.runStage("create_project", async () => {
    project = await provisionV1GauntletProject({
      options: ctx.options,
      reportDir: ctx.reportDir,
      createdProjectSlugs: ctx.createdProjectSlugs,
    });
    ctx.projects.push(project);
  });

  await ctx.runStage("push_valid_schema", async () => {
    await pushValidGauntletSchema(project);
  });

  await ctx.runStage("backup_create_unverified", async () => {
    const created = await client.createProjectBackup(project.hash);
    const backup = created.backup;
    ctx.artifacts.backupId = backup.id;
    ctx.artifacts.backupStatus = backup.restoreVerificationStatus ?? "pending";
  });

  await ctx.runStage("operator_nuke_blocked", async () => {
    const attempt = await attemptOperatorNuke(project);
    if (!attempt.blocked) {
      throw new Error(
        `Operator nuke was not blocked by backup gate: ${attempt.message}`,
      );
    }
    ctx.artifacts.nukeBlockedMessage = attempt.message.slice(0, 400);
  });

  await ctx.runStage("gauntlet_cleanup", async () => {
    const result = await matrixCleanupProject({
      project,
      options: ctx.options,
      createdProjectSlugs: ctx.createdProjectSlugs,
      scenarioFailed: false,
    });
    ctx.artifacts.cleanup = result;
    if (!result.cleanedUp) {
      throw new Error(result.cleanupError ?? "Gauntlet cleanup failed");
    }
  });

  await ctx.runStage("verify_absent", async () => {
    await assertProjectAbsent(project.slug);
  });
}

export const MATRIX_SCENARIOS: Record<
  MatrixScenarioName,
  { description: string; run: MatrixScenarioFn }
> = {
  create_duplicate_project: {
    description: "Reject duplicate project creation; cleanup original",
    run: scenarioCreateDuplicateProject,
  },
  push_invalid_sql: {
    description: "Invalid SQL fails; API remains healthy; cleanup",
    run: scenarioPushInvalidSql,
  },
  env_set_and_list_redaction: {
    description: "Env set/list with sensitive value redaction",
    run: scenarioEnvSetAndListRedaction,
  },
  stop_start_project: {
    description: "Stop/start lifecycle and health recovery",
    run: scenarioStopStartProject,
  },
  double_stop_project: {
    description: "Repeated stop is idempotent or cleanly rejected",
    run: scenarioDoubleStopProject,
  },
  missing_project_errors: {
    description: "Missing-project operations fail with not-found errors",
    run: scenarioMissingProjectErrors,
  },
  backup_gate_blocks_destructive_action: {
    description: "Backup gate blocks operator nuke; gauntlet cleanup works",
    run: scenarioBackupGateBlocksDestructive,
  },
};

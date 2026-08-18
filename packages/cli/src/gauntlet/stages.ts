import { createFluxDocker, assertFluxDockerEngineReachableOrThrow } from "@flux/core";
import { getApiClient } from "../api-client";
import {
  formatIntrospectionSummary,
  inspectOpenApiSchema,
  probeInsertEvent,
  probeInsertNote,
  probeUnauthenticatedAccessIsInert,
  probeSelectEventByNoteId,
  probeSelectNote,
} from "./api-probe";
import { assertPostgrestHealthy } from "./health-probe";
import { isGauntletSlug } from "./names";
import { pushGauntletSchema } from "./push-schema";
import {
  inspectProjectSchema,
} from "./schema-inspector";
import {
  formatSchemaInspectionStageSummary,
  writeSchemaInspectionArtifacts,
} from "./schema-story-report";
import { SchemaInspectionUnsupportedError } from "./schema-inspector-types";
import { GauntletStageSkip } from "./types";
import type {
  GauntletProjectCtx,
  GauntletRunnerState,
  GauntletStageName,
  StageRecord,
} from "./types";

export type StageExecutor = (
  state: GauntletRunnerState,
  stage: StageRecord,
) => Promise<void>;

function requireProject(state: GauntletRunnerState): GauntletProjectCtx {
  if (!state.project) {
    throw new Error("Gauntlet project context missing");
  }
  return state.project;
}

function probeAuthContext(project: GauntletProjectCtx) {
  return {
    apiUrl: project.apiUrl,
    apiSchema: project.apiSchema,
    mode: project.mode,
    hash: project.hash,
    ...(project.anonJwt ? { anonJwt: project.anonJwt } : {}),
    ...(project.serviceRoleJwt ? { serviceRoleJwt: project.serviceRoleJwt } : {}),
    ...(project.projectJwt ? { projectJwt: project.projectJwt } : {}),
  };
}

export async function stagePreflight(
  _state: GauntletRunnerState,
  stage: StageRecord,
): Promise<void> {
  await assertFluxDockerEngineReachableOrThrow(createFluxDocker());
  const client = getApiClient();
  await client.listProjects();
  stage.summary = "Docker reachable; CLI authenticated";
}

export async function stageCreateProject(
  state: GauntletRunnerState,
  stage: StageRecord,
): Promise<void> {
  const client = getApiClient();
  const pending = state.pendingCreate;
  if (!pending?.requestedName?.trim() || !pending.reportDir?.trim()) {
    throw new Error("create_project missing pendingCreate from runner");
  }
  const { requestedName: name, reportDir } = pending;

  const result = await client.createProject({
    name,
    stripSupabaseRestPrefix: true,
    mode: state.options.mode,
  });

  const slug = result.summary.slug;
  if (!isGauntletSlug(slug, state.options.prefix)) {
    throw new Error(
      `Created project slug "${slug}" does not match gauntlet marker — refusing to continue`,
    );
  }

  state.createdProjectSlugs.add(slug.toLowerCase());

  const metadata = await client.getProjectMetadata(result.summary.hash);
  const creds = await client.getProjectCredentialsByHash(result.summary.hash);

  const project: GauntletProjectCtx = {
    slug,
    hash: result.summary.hash,
    mode: result.mode,
    apiUrl: result.summary.apiUrl,
    apiSchema:
      metadata.apiSchema ?? (result.mode === "v1_dedicated" ? "api" : ""),
    reportDir,
  };

  if (result.mode === "v1_dedicated") {
    if (creds.mode !== "v1_dedicated") {
      throw new Error("Expected v1_dedicated credentials");
    }
    project.anonJwt = creds.anonKey;
    project.serviceRoleJwt = creds.serviceRoleKey;
    if (creds.projectJwtSecret) {
      project.projectJwt = creds.projectJwtSecret;
    } else if (result.projectJwtSecret) {
      project.projectJwt = result.projectJwtSecret;
    }
  } else {
    if (creds.mode !== "v2_shared") {
      throw new Error("Expected v2_shared credentials");
    }
    project.projectJwt =
      creds.projectJwtSecret ??
      result.projectJwtSecret ??
      result.secrets.pgrstJwtSecret;
    if (!project.apiSchema) {
      throw new Error("v2_shared project missing apiSchema in metadata");
    }
  }

  project.projectSummaryBefore = {
    summary: result.summary,
    mode: result.mode,
    apiSchema: project.apiSchema,
  };

  state.project = project;
  stage.summary = `Project created (${slug} #${result.summary.hash})`;
  stage.artifacts = {
    requestedName: name,
    reportDir,
    slug,
    hash: result.summary.hash,
    apiUrl: result.summary.apiUrl,
  };
}

export async function stageWaitForHealth(
  state: GauntletRunnerState,
  stage: StageRecord,
): Promise<void> {
  const project = requireProject(state);
  const health = await assertPostgrestHealthy({
    apiUrl: project.apiUrl,
    apiSchema: project.apiSchema,
    mode: project.mode,
    hash: project.hash,
    ...(project.serviceRoleJwt ? { serviceRoleJwt: project.serviceRoleJwt } : {}),
    ...(project.projectJwt ? { projectJwt: project.projectJwt } : {}),
  });
  project.openapiSnapshot = health.openapi;
  stage.summary = `PostgREST OpenAPI healthy (HTTP ${String(health.httpStatus)}, ${String(health.attempts)} attempt(s))`;
  stage.artifacts = { httpStatus: health.httpStatus, attempts: health.attempts };
}

export async function stagePushSchema(
  state: GauntletRunnerState,
  stage: StageRecord,
): Promise<void> {
  const project = requireProject(state);

  if (project.mode === "v2_shared" && !project.projectJwt?.trim()) {
    throw new GauntletStageSkip(
      "v2_shared push_schema skipped: no projectJwt from create/credentials",
    );
  }

  try {
    const result = await pushGauntletSchema(project);
    project.schemaSqlPath = result.schemaSqlPath;
    stage.summary =
      project.mode === "v1_dedicated"
        ? `Schema pushed via CLI (${result.schemaSqlPath})`
        : `Schema pushed via dashboard route (${result.schemaSqlPath})`;
    stage.artifacts = {
      schemaSqlPath: result.schemaSqlPath,
      pushMode: result.mode,
      ...(result.tablesMoved !== undefined
        ? { tablesMoved: result.tablesMoved }
        : {}),
    };
  } catch (err: unknown) {
    if (project.mode === "v2_shared") {
      const msg = err instanceof Error ? err.message : String(err);
      throw new GauntletStageSkip(`v2_shared push unavailable: ${msg}`);
    }
    throw err;
  }
}

export async function stageInspectSchema(
  state: GauntletRunnerState,
  stage: StageRecord,
): Promise<void> {
  const project = requireProject(state);

  // A successful pooled push commits NOTIFY pgrst, but PostgREST applies the
  // schema reload asynchronously. Poll for the new paths rather than treating
  // the first still-valid pre-push OpenAPI document as a permanent failure.
  const maxSchemaAttempts = 20;
  let intro: ReturnType<typeof inspectOpenApiSchema> | undefined;
  for (let attempt = 1; attempt <= maxSchemaAttempts; attempt++) {
    const health = await assertPostgrestHealthy({
      apiUrl: project.apiUrl,
      apiSchema: project.apiSchema,
      mode: project.mode,
      hash: project.hash,
      maxAttempts: 1,
      ...(project.serviceRoleJwt
        ? { serviceRoleJwt: project.serviceRoleJwt }
        : {}),
      ...(project.projectJwt ? { projectJwt: project.projectJwt } : {}),
    });
    project.openapiSnapshot = health.openapi;
    intro = inspectOpenApiSchema(health.openapi);
    if (intro.hasGauntletNotes && intro.hasGauntletEvents) break;
    if (attempt < maxSchemaAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  if (!intro?.hasGauntletNotes || !intro.hasGauntletEvents) {
    throw new Error(
      `PostgREST cache missing tables after ${String(maxSchemaAttempts)} attempts: notes=${String(intro?.hasGauntletNotes ?? false)} events=${String(intro?.hasGauntletEvents ?? false)}`,
    );
  }

  stage.summary = formatIntrospectionSummary(intro);
  stage.artifacts = { introspection: intro };
}

export async function stageInspectSchemaDeep(
  state: GauntletRunnerState,
  stage: StageRecord,
): Promise<void> {
  const project = requireProject(state);

  if (project.mode !== "v1_dedicated") {
    throw new GauntletStageSkip(
      "v2_shared inspect_schema_deep skipped: Postgres catalog introspection is v1_dedicated only",
    );
  }

  try {
    const inspection = await inspectProjectSchema({
      slug: project.slug,
      hash: project.hash,
      mode: project.mode,
      apiSchema: project.apiSchema,
      apiUrl: project.apiUrl,
      includeExactCounts: true,
    });
    project.schemaInspection = inspection;
    await writeSchemaInspectionArtifacts({
      reportDir: project.reportDir,
      result: inspection,
    });
    stage.summary = formatSchemaInspectionStageSummary(inspection);
    stage.artifacts = {
      tableCount: inspection.summary.tableCount,
      warningCount: inspection.warnings.length,
    };
  } catch (err: unknown) {
    if (err instanceof SchemaInspectionUnsupportedError) {
      throw new GauntletStageSkip(err.message);
    }
    throw err;
  }
}

export async function stageApiInsert(
  state: GauntletRunnerState,
  stage: StageRecord,
): Promise<void> {
  const project = requireProject(state);
  const { id } = await probeInsertNote(probeAuthContext(project));
  project.insertedNoteId = id;
  stage.summary = `Inserted note id ${String(id)}`;
  stage.artifacts = { noteId: id };
}

export async function stageApiSelect(
  state: GauntletRunnerState,
  stage: StageRecord,
): Promise<void> {
  const project = requireProject(state);
  const noteId = project.insertedNoteId;
  if (noteId === undefined) {
    throw new Error("api_select requires insertedNoteId from api_insert");
  }

  const probeCtx = probeAuthContext(project);
  await probeSelectNote(probeCtx, noteId);
  const { id: eventId } = await probeInsertEvent(probeCtx, noteId);
  await probeSelectEventByNoteId(probeCtx, noteId);
  project.insertedEventId = eventId;
  stage.summary = `Selected note ${String(noteId)}; inserted event ${String(eventId)}`;
  stage.artifacts = { noteId, eventId };
}

export async function stageApiUnauthInert(
  state: GauntletRunnerState,
  stage: StageRecord,
): Promise<void> {
  const project = requireProject(state);
  const noteId = project.insertedNoteId;
  if (noteId === undefined) {
    throw new Error("api_unauth_inert requires insertedNoteId from api_insert");
  }
  const result = await probeUnauthenticatedAccessIsInert(
    probeAuthContext(project),
    noteId,
  );
  stage.summary = `Anonymous read/write inert (GET ${String(result.readStatus)}, POST ${String(result.writeStatus)})`;
  stage.artifacts = result;
}

export async function stageBackupCreate(
  state: GauntletRunnerState,
  stage: StageRecord,
): Promise<void> {
  if (state.options.skipBackup) {
    throw new GauntletStageSkip("Skipped (--skip-backup)");
  }

  const project = requireProject(state);
  const client = getApiClient();
  const created = await client.createProjectBackup(project.hash);
  const backup = created.backup;
  project.backupId = backup.id;
  const kind = backup.kind ?? (project.mode === "v2_shared" ? "tenant_export" : "project_db");
  stage.summary = `Backup created (${backup.id}, ${kind})`;
  stage.artifacts = { backupId: backup.id, kind };
}

export async function stageBackupVerify(
  state: GauntletRunnerState,
  stage: StageRecord,
): Promise<void> {
  if (state.options.skipBackup) {
    throw new GauntletStageSkip("Skipped (--skip-backup)");
  }

  const project = requireProject(state);
  const backupId = project.backupId;
  if (!backupId?.trim()) {
    throw new GauntletStageSkip("Skipped (no backup id from backup_create)");
  }

  const verify = await getApiClient().verifyProjectBackup({
    hash: project.hash,
    backupId,
  });

  if (verify.restoreVerificationStatus !== "restore_verified") {
    throw new Error(
      `Restore verification failed (status=${verify.restoreVerificationStatus})`,
    );
  }

  stage.summary = `Restore verified for backup ${backupId}`;
  stage.artifacts = {
    backupId,
    restoreVerificationStatus: verify.restoreVerificationStatus,
  };
}

/** Placeholder — actual delete runs in runner cleanup finalization. */
export async function stageDeleteProject(
  _state: GauntletRunnerState,
  stage: StageRecord,
): Promise<void> {
  stage.summary = "Awaiting runner cleanup";
}

export async function stagePostCleanupVerify(
  state: GauntletRunnerState,
  stage: StageRecord,
): Promise<void> {
  if (state.options.keepFailed) {
    throw new GauntletStageSkip("Skipped (--keep-failed)");
  }

  const project = requireProject(state);
  const projects = await getApiClient().listProjects();
  const stillThere = projects.some(
    (p) => p.slug.toLowerCase() === project.slug.toLowerCase(),
  );
  if (stillThere) {
    throw new Error(
      `Project ${project.slug} still listed after cleanup — manual nuke may be required`,
    );
  }
  stage.summary = "Project absent from catalog";
}

export const STAGE_EXECUTORS: Record<GauntletStageName, StageExecutor> = {
  preflight: stagePreflight,
  create_project: stageCreateProject,
  wait_for_health: stageWaitForHealth,
  push_schema: stagePushSchema,
  inspect_schema: stageInspectSchema,
  inspect_schema_deep: stageInspectSchemaDeep,
  api_insert: stageApiInsert,
  api_unauth_inert: stageApiUnauthInert,
  api_select: stageApiSelect,
  backup_create: stageBackupCreate,
  backup_verify: stageBackupVerify,
  delete_project: stageDeleteProject,
  post_cleanup_verify: stagePostCleanupVerify,
};

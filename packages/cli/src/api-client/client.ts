import type {
  FluxMigrationRecord,
  MigrationPushMeta,
} from "@flux/core/sql-migrations";
import type { RepeatablePushMeta } from "@flux/core/sql-repeatable-scripts";
import type {
  FluxProjectEnvEntry,
  FluxProjectSummary,
  ImportSqlFileResult,
} from "@flux/core/standalone";
import { resolveFluxApiToken } from "../config";
import { resolveMcpServerToken } from "./mcp-auth";
import { normalizeFluxApiBase } from "./normalize-api-base";
import { HOSTED_FLUX_PUBLIC_API_BASE } from "../utils/env-file";
import * as backups from "./backups";
import * as dbAccess from "./db-access";
import type { ApiClientContext } from "./context";
import * as env from "./env";
import * as logs from "./logs";
import * as migrate from "./migrate";
import * as projects from "./projects";
import * as migrations from "./migrations";
import * as push from "./push";
import * as schemaInspection from "./schema-inspection";
import type { SchemaInspectionResult } from "@flux/core/schema-inspection";
import * as doctor from "./doctor";
import type { DoctorReport } from "./doctor";
import * as activity from "./activity";
import type { ProjectActivityResponse } from "./activity";
import * as projectMetadata from "./project-metadata";
import * as projectFluxMd from "./project-flux-md";
import * as projectAiSummary from "./project-ai-summary";
import * as projectLifecycleState from "./project-lifecycle-state";
import * as mcpAudit from "./mcp-audit";
import * as mcpIntents from "./mcp-intents";
import type { ProjectAiSummary, ProjectFluxMdDetail, ProjectMetadataDetail } from "./schemas";
import type {
  CreateMcpIntentInput,
  CreateMcpIntentResult,
  ListMcpIntentsQuery,
  ListMcpIntentsResult,
  McpIntentDetail,
} from "./mcp-intents";
import type { RecordMcpAuditEventInput, RecordMcpAuditEventResult } from "./mcp-audit";
import type {
  CreateProjectMode,
  CreateProjectResult,
  InitProjectResult,
  ListProjectBackupsResult,
  ProjectBackup,
  ProjectCredentialsByHash,
  ProjectMetadata,
  VerifyBackupResult,
  VerifyTokenResult,
} from "./schemas";

const DEFAULT_BASE = HOSTED_FLUX_PUBLIC_API_BASE;

function resolveApiBase(): string {
  const raw = process.env.FLUX_API_BASE?.trim();
  return raw && raw.length > 0 ? normalizeFluxApiBase(raw) : DEFAULT_BASE;
}

function notImplemented(baseUrl: string, method: string): Error {
  return new Error(
    `Not implemented: ApiClient.${method} — connect ${baseUrl} when the control-plane API is available.`,
  );
}

/**
 * Base URL: hosted default (`HOSTED_FLUX_PUBLIC_API_BASE`), `process.env.FLUX_API_BASE`, inferred from `FLUX_URL` when it is a `*.vsl-base.com` tenant Service URL, or project `.env` / `.env.local` (shell wins).
 * Auth: `Authorization: Bearer` from `FLUX_API_TOKEN` or `~/.flux/config.json` (from `flux login`).
 * MCP servers should use {@link getMcpApiClient} (`FLUX_MCP_TOKEN` → `FLUX_API_TOKEN` → config).
 */
export class ApiClient {
  readonly baseUrl: string;
  private readonly resolveToken: () => string | undefined;

  constructor(
    baseUrl: string = resolveApiBase(),
    options?: { resolveToken?: () => string | undefined },
  ) {
    this.baseUrl = normalizeFluxApiBase(baseUrl);
    this.resolveToken = options?.resolveToken ?? resolveFluxApiToken;
  }

  private tokenOrThrow(): string {
    const t = this.resolveToken();
    if (!t) {
      throw new Error(
        "Not authenticated. Set FLUX_API_TOKEN or run `flux login`.",
      );
    }
    return t;
  }

  private asContext(): ApiClientContext {
    return {
      baseUrl: this.baseUrl,
      tokenOrThrow: () => this.tokenOrThrow(),
    };
  }

  /** Prepare headers for `fetch` once control-plane methods are implemented. */
  authHeaders(): Headers {
    const h = new Headers();
    const t = this.resolveToken();
    if (t) h.set("Authorization", `Bearer ${t}`);
    return h;
  }

  /**
   * GET /api/cli/v1/auth/verify — check a token (e.g. before persisting in `flux login`).
   */
  verifyToken(token: string): Promise<VerifyTokenResult> {
    return projects.verifyToken(this.asContext(), token);
  }

  getProjectMetadata(hash: string): Promise<ProjectMetadata> {
    return projects.getProjectMetadata(this.asContext(), hash);
  }

  /**
   * POST /api/cli/v1/migrate — v2_shared → v1_dedicated (control-plane orchestrated).
   */
  migrateV2ToV1(input: {
    slug: string;
    hash: string;
    dryRun?: boolean;
    yes?: boolean;
    staged?: boolean;
    dumpOnly?: boolean;
    preserveJwtSecret?: boolean;
    newJwtSecret?: boolean;
    lockWrites?: boolean;
    noLockWrites?: boolean;
    dropSourceAfter?: boolean;
    skipBackupCheck?: boolean;
  }): Promise<unknown> {
    return migrate.migrateV2ToV1(this.asContext(), input);
  }

  // ---------------------------------------------------------------------------
  // GET /api/cli/v1/list — catalog + Docker summaries for the token owner
  // ---------------------------------------------------------------------------
  listProjects(): Promise<FluxProjectSummary[]> {
    return projects.listProjects(this.asContext());
  }

  // ---------------------------------------------------------------------------
  // POST /api/cli/v1/create — body: { name, stripSupabaseRestPrefix?, mode? }
  // ---------------------------------------------------------------------------
  createProject(input: {
    name: string;
    stripSupabaseRestPrefix: boolean;
    mode?: CreateProjectMode;
  }): Promise<CreateProjectResult> {
    return projects.createProject(this.asContext(), input);
  }

  // ---------------------------------------------------------------------------
  // POST /api/cli/v1/init — link or create by slug (no secrets in response)
  // ---------------------------------------------------------------------------
  initProject(input: {
    slug: string;
    stripSupabaseRestPrefix?: boolean;
    mode?: CreateProjectMode;
  }): Promise<InitProjectResult> {
    return projects.initProject(this.asContext(), input);
  }

  // ---------------------------------------------------------------------------
  // GET /api/cli/v1/projects/:hash/credentials — tenant JWT (v2) or full v1 secrets
  // ---------------------------------------------------------------------------
  getProjectCredentialsByHash(hash: string): Promise<ProjectCredentialsByHash> {
    return projects.getProjectCredentialsByHash(this.asContext(), hash);
  }

  getProjectDbAccessPlan(
    hash: string,
    options?: {
      localPort?: number;
      sshHost?: string;
      sshUser?: string;
      sshPort?: number;
    },
  ): Promise<import("@flux/core").DatabaseAccessPlan> {
    return dbAccess.getProjectDbAccessPlan(this.asContext(), hash, options);
  }

  createTemporaryProjectDbCredential(
    hash: string,
    options?: {
      access?: import("@flux/core").DbAccessLevel;
      ttlSeconds?: number;
    },
  ): Promise<dbAccess.TemporaryDbCredential> {
    return dbAccess.createTemporaryProjectDbCredential(this.asContext(), hash, options);
  }

  // ---------------------------------------------------------------------------
  // POST /api/cli/v1/push — body: { slug, hash, sql }
  // ---------------------------------------------------------------------------
  pushSql(input: {
    slug: string;
    hash: string;
    sql: string;
    migration?: MigrationPushMeta;
    repeatable?: RepeatablePushMeta;
  }): Promise<push.PushSqlResult> {
    return push.pushSql(this.asContext(), input);
  }

  schemaInspectProject(input: {
    hash: string;
    includeExactCounts?: boolean;
  }): Promise<SchemaInspectionResult> {
    return schemaInspection.schemaInspectProject(this.asContext(), input);
  }

  runDoctor(hash: string): Promise<DoctorReport> {
    return doctor.runDoctorForHash(this.asContext(), hash);
  }

  fetchProjectActivity(
    hash: string,
    limit?: number,
  ): Promise<ProjectActivityResponse> {
    return activity.fetchProjectActivity(this.asContext(), hash, limit);
  }

  fetchProjectMetadataDetail(hash: string): Promise<ProjectMetadataDetail> {
    return projectMetadata.fetchProjectMetadataDetail(this.asContext(), hash);
  }

  patchProjectMetadata(
    hash: string,
    patch: { description?: string | null; brief?: string | null },
  ): Promise<ProjectMetadataDetail> {
    return projectMetadata.patchProjectMetadata(this.asContext(), hash, patch);
  }

  fetchProjectFluxMdDetail(hash: string): Promise<ProjectFluxMdDetail> {
    return projectFluxMd.fetchProjectFluxMdDetail(this.asContext(), hash);
  }

  syncProjectFluxMd(
    hash: string,
    content: string | null,
  ): Promise<ProjectFluxMdDetail> {
    return projectFluxMd.syncProjectFluxMd(this.asContext(), hash, content);
  }

  generateProjectAiSummary(
    hash: string,
    kind: "brief" | "activity" | "resume",
  ): Promise<ProjectAiSummary> {
    return projectAiSummary.generateProjectAiSummary(this.asContext(), hash, kind);
  }

  getProjectLifecycleState(
    hash: string,
  ): Promise<projectLifecycleState.ProjectLifecycleInfo> {
    return projectLifecycleState.getProjectLifecycleState(this.asContext(), hash);
  }

  runProjectLifecycleAction(
    hash: string,
    action: import("@flux/core/project-lifecycle-state").ProjectLifecycleAction,
  ): Promise<{ lifecycleState: import("@flux/core/project-lifecycle-state").ProjectLifecycleState; noop?: boolean }> {
    return projectLifecycleState.runProjectLifecycleAction(
      this.asContext(),
      hash,
      action,
    );
  }

  listAppliedMigrations(hash: string): Promise<FluxMigrationRecord[]> {
    return migrations.listAppliedMigrationsV1(this.asContext(), hash);
  }

  // ---------------------------------------------------------------------------
  // Reads a local .sql file and applies it via {@link pushSql} (no local Docker).
  // Supabase / sanitize options are reserved for a future control-plane import path.
  // ---------------------------------------------------------------------------
  importSqlFile(
    project: string,
    filePath: string,
    hash: string,
    options: {
      supabaseCompat: boolean;
      sanitizeForTarget: boolean;
      moveFromPublic: boolean;
      disableRowLevelSecurityInApi?: boolean;
    },
  ): Promise<ImportSqlFileResult> {
    return push.importSqlFile(this.asContext(), project, filePath, hash, options);
  }

  // ---------------------------------------------------------------------------
  // GET /api/cli/v1/logs?slug=&hash=&service= — Server-Sent Events: { line } / { error }
  // ---------------------------------------------------------------------------
  streamContainerLogs(
    input: {
      slug: string;
      hash: string;
      service: "api" | "db";
    },
    onEvent: (ev: { line?: string; error?: string }) => void,
    init?: { signal?: AbortSignal },
  ): Promise<void> {
    return logs.streamContainerLogs(this.asContext(), input, onEvent, init);
  }

  // ---------------------------------------------------------------------------
  // GET /projects/{slug}/cors-origins?hash=
  // ---------------------------------------------------------------------------
  getProjectAllowedOrigins(_project: string, _hash: string): Promise<readonly string[]> {
    return Promise.reject(notImplemented(this.baseUrl, "getProjectAllowedOrigins"));
  }

  // ---------------------------------------------------------------------------
  // PUT /projects/{slug}/cors-origins?hash= — full list replace
  // ---------------------------------------------------------------------------
  setProjectAllowedOrigins(
    _project: string,
    _origins: readonly string[],
    _hash: string,
  ): Promise<void> {
    return Promise.reject(notImplemented(this.baseUrl, "setProjectAllowedOrigins"));
  }

  // ---------------------------------------------------------------------------
  // POST /projects/{slug}/db-reset?hash= — body: { confirm: true } TBD
  // ---------------------------------------------------------------------------
  resetTenantDatabaseForImport(_project: string, _hash: string): Promise<void> {
    return Promise.reject(
      notImplemented(this.baseUrl, "resetTenantDatabaseForImport"),
    );
  }

  // ---------------------------------------------------------------------------
  // PATCH /projects/{slug}/postgrest?hash= — { stripSupabaseRestPrefix: bool }
  // ---------------------------------------------------------------------------
  setPostgrestSupabaseRestPrefix(
    _project: string,
    _enable: boolean,
    _hash: string,
  ): Promise<void> {
    return Promise.reject(
      notImplemented(this.baseUrl, "setPostgrestSupabaseRestPrefix"),
    );
  }

  // ---------------------------------------------------------------------------
  // GET /projects/{slug}/keys?hash= — { anonKey, serviceRoleKey }
  // ---------------------------------------------------------------------------
  getProjectKeys(
    _project: string,
    _hash: string,
  ): Promise<{ anonKey: string; serviceRoleKey: string }> {
    return Promise.reject(notImplemented(this.baseUrl, "getProjectKeys"));
  }

  // ---------------------------------------------------------------------------
  // POST /cli/v1/projects/:hash/lifecycle — { action: "start" | "stop" }
  // ---------------------------------------------------------------------------
  stopProject(project: string, hash: string): Promise<void> {
    return projects.stopProject(this.asContext(), project, hash);
  }

  startProject(project: string, hash: string): Promise<void> {
    return projects.startProject(this.asContext(), project, hash);
  }

  // ---------------------------------------------------------------------------
  // GET /cli/v1/projects/:hash/dump?schemaOnly=&dataOnly=&clean=&publicOnly=
  // ---------------------------------------------------------------------------
  getProjectDumpStream(input: {
    hash: string;
    schemaOnly?: boolean;
    dataOnly?: boolean;
    clean?: boolean;
    publicOnly?: boolean;
  }): Promise<ReadableStream<Uint8Array>> {
    return backups.getProjectDumpStream(this.asContext(), input);
  }

  listProjectBackups(hash: string): Promise<ListProjectBackupsResult> {
    return backups.listProjectBackups(this.asContext(), hash);
  }

  createProjectBackup(hash: string): Promise<import("./schemas").CreateProjectBackupResult> {
    return backups.createProjectBackup(this.asContext(), hash);
  }

  getProjectBackupStream(input: {
    hash: string;
    backupId: string;
  }): Promise<ReadableStream<Uint8Array>> {
    return backups.getProjectBackupStream(this.asContext(), input);
  }

  verifyProjectBackup(input: {
    hash: string;
    backupId: string;
  }): Promise<VerifyBackupResult> {
    return backups.verifyProjectBackup(this.asContext(), input);
  }

  // ---------------------------------------------------------------------------
  // DELETE /cli/v1/projects/:hash — atomic nuke (see deploy catalog + orphan `force`)
  // ---------------------------------------------------------------------------
  nukeProject(
    project: string,
    hash: string,
    options?: { forceOrphan?: boolean; skipBackupCheck?: boolean },
  ): Promise<{ mode: "catalog" | "orphan" }> {
    return projects.nukeProject(this.asContext(), project, hash, options);
  }

  // ---------------------------------------------------------------------------
  // POST /admin/reap — { hours: number } (catalog idle; TBD)
  // ---------------------------------------------------------------------------
  reapIdleProjects(_hours: number): Promise<{
    stopped: string[];
    errors: { slug: string; message: string }[];
  }> {
    return Promise.reject(notImplemented(this.baseUrl, "reapIdleProjects"));
  }

  // ---------------------------------------------------------------------------
  // GET /projects/{slug}/api-env?hash=
  // ---------------------------------------------------------------------------
  listProjectEnv(project: string, hash: string): Promise<FluxProjectEnvEntry[]> {
    return env.listProjectEnv(this.asContext(), project, hash);
  }

  // ---------------------------------------------------------------------------
  // PATCH /projects/{slug}/api-env?hash= — partial env map
  // ---------------------------------------------------------------------------
  setProjectEnv(
    project: string,
    envMap: Record<string, string>,
    hash: string,
  ): Promise<void> {
    return env.setProjectEnv(this.asContext(), project, envMap, hash);
  }

  // ---------------------------------------------------------------------------
  // POST /cli/v1/audit — MCP tool-call audit ledger
  // ---------------------------------------------------------------------------
  recordMcpAuditEvent(input: RecordMcpAuditEventInput): Promise<RecordMcpAuditEventResult> {
    return mcpAudit.recordMcpAuditEvent(this.asContext(), input);
  }

  // ---------------------------------------------------------------------------
  // POST /cli/v1/intents — MCP agent intents
  // ---------------------------------------------------------------------------
  createMcpIntent(input: CreateMcpIntentInput): Promise<CreateMcpIntentResult> {
    return mcpIntents.createMcpIntent(this.asContext(), input);
  }

  getMcpIntent(intentId: string): Promise<McpIntentDetail> {
    return mcpIntents.getMcpIntent(this.asContext(), intentId);
  }

  listMcpIntents(query?: ListMcpIntentsQuery): Promise<ListMcpIntentsResult> {
    return mcpIntents.listMcpIntents(this.asContext(), query ?? {});
  }

  updateMcpIntent(
    intentId: string,
    input: mcpIntents.UpdateMcpIntentInput,
  ): Promise<mcpIntents.UpdateMcpIntentResult> {
    return mcpIntents.updateMcpIntent(this.asContext(), intentId, input);
  }
}

let singleton: ApiClient | undefined;
let mcpSingleton: ApiClient | undefined;

export function getApiClient(): ApiClient {
  return (singleton ??= new ApiClient());
}

/** MCP server client — prefers `FLUX_MCP_TOKEN` over CLI token sources. */
export function getMcpApiClient(): ApiClient {
  return (mcpSingleton ??= new ApiClient(undefined, {
    resolveToken: () => resolveMcpServerToken().token,
  }));
}

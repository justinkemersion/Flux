import type {
  FluxProjectEnvEntry,
  FluxProjectSummary,
  ImportSqlFileResult,
} from "@flux/core/standalone";
import { resolveFluxApiToken } from "../config";
import { HOSTED_FLUX_PUBLIC_API_BASE } from "../utils/env-file";
import * as backups from "./backups";
import type { ApiClientContext } from "./context";
import * as env from "./env";
import * as logs from "./logs";
import * as migrate from "./migrate";
import * as projects from "./projects";
import * as push from "./push";
import type {
  CreateProjectMode,
  CreateProjectResult,
  ListProjectBackupsResult,
  ProjectBackup,
  ProjectCredentialsByHash,
  ProjectMetadata,
  VerifyBackupResult,
  VerifyTokenResult,
} from "./schemas";
import type { ApiClientContext } from "./context";

const DEFAULT_BASE = HOSTED_FLUX_PUBLIC_API_BASE;

function resolveApiBase(): string {
  const raw = process.env.FLUX_API_BASE?.trim();
  return raw && raw.length > 0 ? raw.replace(/\/$/, "") : DEFAULT_BASE;
}

function notImplemented(baseUrl: string, method: string): Error {
  return new Error(
    `Not implemented: ApiClient.${method} — connect ${baseUrl} when the control-plane API is available.`,
  );
}

/**
 * Base URL: hosted default (`HOSTED_FLUX_PUBLIC_API_BASE`), `process.env.FLUX_API_BASE`, inferred from `FLUX_URL` when it is a `*.vsl-base.com` tenant Service URL, or project `.env` / `.env.local` (shell wins).
 * Auth: `Authorization: Bearer` from `FLUX_API_TOKEN` or `~/.flux/config.json` (from `flux login`).
 */
export class ApiClient {
  readonly baseUrl: string;

  constructor(baseUrl: string = resolveApiBase()) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private tokenOrThrow(): string {
    const t = resolveFluxApiToken();
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
    const t = resolveFluxApiToken();
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
  // GET /api/cli/v1/projects/:hash/credentials — tenant JWT (v2) or full v1 secrets
  // ---------------------------------------------------------------------------
  getProjectCredentialsByHash(hash: string): Promise<ProjectCredentialsByHash> {
    return projects.getProjectCredentialsByHash(this.asContext(), hash);
  }

  // ---------------------------------------------------------------------------
  // POST /api/cli/v1/push — body: { slug, hash, sql }
  // ---------------------------------------------------------------------------
  pushSql(input: {
    slug: string;
    hash: string;
    sql: string;
  }): Promise<ImportSqlFileResult> {
    return push.pushSql(this.asContext(), input);
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

  createProjectBackup(hash: string): Promise<ProjectBackup> {
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
    options?: { forceOrphan?: boolean },
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
}

let singleton: ApiClient | undefined;

export function getApiClient(): ApiClient {
  return (singleton ??= new ApiClient());
}

import type {
  FluxProjectEnvEntry,
  FluxProjectSummary,
  ImportSqlFileResult,
} from "@flux/core/standalone";

const DEFAULT_BASE = "https://flux.vsl-base.com/api";

/**
 * Base URL: `https://flux.vsl-base.com/api` by default, or `process.env.FLUX_API_BASE` (no trailing slash).
 * Auth: `Authorization: Bearer <FLUX_API_TOKEN>` when the env var is set (placeholder until routes exist).
 */
export class ApiClient {
  readonly baseUrl: string;

  constructor(baseUrl: string = resolveApiBase()) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  /** Prepare headers for `fetch` once control-plane methods are implemented. */
  authHeaders(): Headers {
    const h = new Headers();
    const t = process.env.FLUX_API_TOKEN?.trim();
    if (t) h.set("Authorization", `Bearer ${t}`);
    return h;
  }

  private notImplemented(method: string): Error {
    return new Error(
      `Not implemented: ApiClient.${method} — connect ${this.baseUrl} when the control-plane API is available.`,
    );
  }

  // ---------------------------------------------------------------------------
  // GET /projects — list projects (dashboard parity)
  // ---------------------------------------------------------------------------
  listProjects(): Promise<FluxProjectSummary[]> {
    return Promise.reject(this.notImplemented("listProjects"));
  }

  // ---------------------------------------------------------------------------
  // POST /projects — provision (body: { name, stripSupabaseRestPrefix?, hash? })
  // ---------------------------------------------------------------------------
  createProject(_input: {
    name: string;
    stripSupabaseRestPrefix: boolean;
    hash?: string;
  }): Promise<{
    name: string;
    slug: string;
    hash: string;
    apiUrl: string;
    postgresUrl: string;
    stripSupabaseRestPrefix: boolean;
  }> {
    return Promise.reject(this.notImplemented("createProject"));
  }

  // ---------------------------------------------------------------------------
  // POST /projects/{slug}/import-sql?hash= — push SQL (multipart or JSON ref TBD)
  // ---------------------------------------------------------------------------
  importSqlFile(
    _project: string,
    _filePath: string,
    _hash: string,
    _options: {
      supabaseCompat: boolean;
      sanitizeForTarget: boolean;
      moveFromPublic: boolean;
      disableRowLevelSecurityInApi?: boolean;
    },
  ): Promise<ImportSqlFileResult> {
    return Promise.reject(this.notImplemented("importSqlFile"));
  }

  // ---------------------------------------------------------------------------
  // GET /projects/{slug}/cors-origins?hash=
  // ---------------------------------------------------------------------------
  getProjectAllowedOrigins(_project: string, _hash: string): Promise<readonly string[]> {
    return Promise.reject(this.notImplemented("getProjectAllowedOrigins"));
  }

  // ---------------------------------------------------------------------------
  // PUT /projects/{slug}/cors-origins?hash= — full list replace
  // ---------------------------------------------------------------------------
  setProjectAllowedOrigins(
    _project: string,
    _origins: readonly string[],
    _hash: string,
  ): Promise<void> {
    return Promise.reject(this.notImplemented("setProjectAllowedOrigins"));
  }

  // ---------------------------------------------------------------------------
  // POST /projects/{slug}/db-reset?hash= — body: { confirm: true } TBD
  // ---------------------------------------------------------------------------
  resetTenantDatabaseForImport(_project: string, _hash: string): Promise<void> {
    return Promise.reject(this.notImplemented("resetTenantDatabaseForImport"));
  }

  // ---------------------------------------------------------------------------
  // PATCH /projects/{slug}/postgrest?hash= — { stripSupabaseRestPrefix: bool }
  // ---------------------------------------------------------------------------
  setPostgrestSupabaseRestPrefix(
    _project: string,
    _enable: boolean,
    _hash: string,
  ): Promise<void> {
    return Promise.reject(this.notImplemented("setPostgrestSupabaseRestPrefix"));
  }

  // ---------------------------------------------------------------------------
  // GET /projects/{slug}/keys?hash= — { anonKey, serviceRoleKey }
  // ---------------------------------------------------------------------------
  getProjectKeys(
    _project: string,
    _hash: string,
  ): Promise<{ anonKey: string; serviceRoleKey: string }> {
    return Promise.reject(this.notImplemented("getProjectKeys"));
  }

  // ---------------------------------------------------------------------------
  // PUT /projects/{slug}/lifecycle?hash= — { action: "start" | "stop" }
  // ---------------------------------------------------------------------------
  stopProject(_project: string, _hash: string): Promise<void> {
    return Promise.reject(this.notImplemented("stopProject"));
  }

  startProject(_project: string, _hash: string): Promise<void> {
    return Promise.reject(this.notImplemented("startProject"));
  }

  // ---------------------------------------------------------------------------
  // DELETE /projects/{slug}?hash= (nuke: acknowledgeDataLoss)
  // ---------------------------------------------------------------------------
  nukeProject(_project: string, _hash: string): Promise<void> {
    return Promise.reject(this.notImplemented("nukeProject"));
  }

  // ---------------------------------------------------------------------------
  // POST /admin/reap — { hours: number } (catalog idle; TBD)
  // ---------------------------------------------------------------------------
  reapIdleProjects(_hours: number): Promise<{
    stopped: string[];
    errors: { slug: string; message: string }[];
  }> {
    return Promise.reject(this.notImplemented("reapIdleProjects"));
  }

  // ---------------------------------------------------------------------------
  // GET /projects/{slug}/api-env?hash=
  // ---------------------------------------------------------------------------
  listProjectEnv(_project: string, _hash: string): Promise<FluxProjectEnvEntry[]> {
    return Promise.reject(this.notImplemented("listProjectEnv"));
  }

  // ---------------------------------------------------------------------------
  // PATCH /projects/{slug}/api-env?hash= — partial env map
  // ---------------------------------------------------------------------------
  setProjectEnv(
    _project: string,
    _env: Record<string, string>,
    _hash: string,
  ): Promise<void> {
    return Promise.reject(this.notImplemented("setProjectEnv"));
  }
}

function resolveApiBase(): string {
  const raw = process.env.FLUX_API_BASE?.trim();
  return raw && raw.length > 0 ? raw.replace(/\/$/, "") : DEFAULT_BASE;
}

let singleton: ApiClient | undefined;

export function getApiClient(): ApiClient {
  return (singleton ??= new ApiClient());
}

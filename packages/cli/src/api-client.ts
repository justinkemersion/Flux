import type {
  FluxProjectEnvEntry,
  FluxProjectSummary,
  ImportSqlFileResult,
} from "@flux/core/standalone";
import { z } from "zod";

const DEFAULT_BASE = "https://flux.vsl-base.com/api";

const fluxProjectSummarySchema = z.object({
  slug: z.string(),
  hash: z.string(),
  status: z.enum([
    "running",
    "stopped",
    "partial",
    "missing",
    "corrupted",
  ]),
  apiUrl: z.string(),
});

const listProjectsResponseSchema = z.array(fluxProjectSummarySchema);

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
  // GET /api/cli/v1/list — catalog + Docker summaries for the token owner
  // ---------------------------------------------------------------------------
  async listProjects(): Promise<FluxProjectSummary[]> {
    const token = process.env.FLUX_API_TOKEN?.trim();
    if (!token) {
      throw new Error(
        "Missing FLUX_API_TOKEN. Export it or run flux login (when available).",
      );
    }
    const url = `${this.baseUrl}/cli/v1/list`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    if (res.status === 401) {
      throw new Error(
        "Invalid or expired API token. Run flux login.",
      );
    }
    const text = await res.text();
    let body: unknown;
    try {
      body = text.trim() ? (JSON.parse(text) as unknown) : null;
    } catch {
      throw new Error(
        `CLI list: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
      );
    }
    if (!res.ok) {
      const msg =
        body &&
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof (body as { error: unknown }).error === "string"
          ? (body as { error: string }).error
          : `Request failed (${String(res.status)})`;
      throw new Error(msg);
    }
    const parsed = listProjectsResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(
        "CLI list: response did not match expected FluxProjectSummary[] shape.",
      );
    }
    return parsed.data;
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

import {
  type FluxProjectEnvEntry,
  type FluxProjectSummary,
  type ImportSqlFileResult,
  slugifyProjectName,
} from "@flux/core/standalone";
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { resolveFluxApiToken } from "./config";

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

const createProjectSecretsSchema = z.object({
  pgrstJwtSecret: z.string(),
  postgresPassword: z.string(),
  postgresContainerHost: z.string(),
  note: z.string(),
});

const createProjectResponseSchema = z.object({
  summary: fluxProjectSummarySchema,
  secrets: createProjectSecretsSchema,
});

const pushSqlResponseSchema = z.object({
  ok: z.boolean().optional(),
  tablesMoved: z.number(),
  sequencesMoved: z.number(),
  viewsMoved: z.number(),
});

export type CreateProjectSecrets = z.infer<typeof createProjectSecretsSchema>;
export type CreateProjectResult = z.infer<typeof createProjectResponseSchema>;

/**
 * Base URL: `https://flux.vsl-base.com/api` (Flux control plane) or `process.env.FLUX_API_BASE` (no trailing slash).
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
  async verifyToken(token: string): Promise<{ ok: true; user: string }> {
    const t = token.trim();
    if (!t) {
      throw new Error("Empty API token.");
    }
    const url = `${this.baseUrl}/cli/v1/auth/verify`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${t}`,
        Accept: "application/json",
      },
    });
    const text = await res.text();
    let raw: unknown;
    try {
      raw = text.trim() ? (JSON.parse(text) as unknown) : null;
    } catch {
      throw new Error(
        `CLI verify: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
      );
    }
    if (res.status === 401) {
      throw new Error("Invalid or expired API token.");
    }
    if (!res.ok) {
      const msg =
        raw &&
        typeof raw === "object" &&
        raw !== null &&
        "error" in raw &&
        typeof (raw as { error: unknown }).error === "string"
          ? (raw as { error: string }).error
          : `Request failed (${String(res.status)})`;
      throw new Error(msg);
    }
    const verifySchema = z.object({
      ok: z.literal(true),
      user: z.string(),
    });
    const parsed = verifySchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error("CLI verify: response did not match { ok, user }.");
    }
    return parsed.data;
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
    const token = this.tokenOrThrow();
    const url = `${this.baseUrl}/cli/v1/list`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    if (res.status === 401) {
      throw new Error("Invalid or expired API token. Run `flux login`.");
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
  // POST /api/cli/v1/create — body: { name, stripSupabaseRestPrefix? }
  // ---------------------------------------------------------------------------
  async createProject(input: {
    name: string;
    stripSupabaseRestPrefix: boolean;
  }): Promise<CreateProjectResult> {
    const token = this.tokenOrThrow();
    const url = `${this.baseUrl}/cli/v1/create`;
    const body: { name: string; stripSupabaseRestPrefix?: boolean } = {
      name: input.name.trim(),
    };
    if (input.stripSupabaseRestPrefix === false) {
      body.stripSupabaseRestPrefix = false;
    }
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      throw new Error("Invalid or expired API token. Run `flux login`.");
    }
    const text = await res.text();
    let raw: unknown;
    try {
      raw = text.trim() ? (JSON.parse(text) as unknown) : null;
    } catch {
      throw new Error(
        `CLI create: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
      );
    }
    if (!res.ok) {
      const msg =
        raw &&
        typeof raw === "object" &&
        raw !== null &&
        "error" in raw &&
        typeof (raw as { error: unknown }).error === "string"
          ? (raw as { error: string }).error
          : `Request failed (${String(res.status)})`;
      throw new Error(msg);
    }
    const parsed = createProjectResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        "CLI create: response did not match expected { summary, secrets } shape.",
      );
    }
    return parsed.data;
  }

  // ---------------------------------------------------------------------------
  // POST /api/cli/v1/push — body: { slug, hash, sql }
  // ---------------------------------------------------------------------------
  async pushSql(input: {
    slug: string;
    hash: string;
    sql: string;
  }): Promise<ImportSqlFileResult> {
    const token = this.tokenOrThrow();
    const url = `${this.baseUrl}/cli/v1/push`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        slug: input.slug.trim(),
        hash: input.hash.trim().toLowerCase(),
        sql: input.sql,
      }),
    });
    if (res.status === 401) {
      throw new Error("Invalid or expired API token. Run `flux login`.");
    }
    const text = await res.text();
    let raw: unknown;
    try {
      raw = text.trim() ? (JSON.parse(text) as unknown) : null;
    } catch {
      throw new Error(
        `CLI push: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
      );
    }
    if (!res.ok) {
      const msg =
        raw &&
        typeof raw === "object" &&
        raw !== null &&
        "error" in raw &&
        typeof (raw as { error: unknown }).error === "string"
          ? (raw as { error: string }).error
          : `Request failed (${String(res.status)})`;
      throw new Error(msg);
    }
    const parsed = pushSqlResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        "CLI push: response did not match expected ImportSqlFileResult shape.",
      );
    }
    return {
      tablesMoved: parsed.data.tablesMoved,
      sequencesMoved: parsed.data.sequencesMoved,
      viewsMoved: parsed.data.viewsMoved,
    };
  }

  // ---------------------------------------------------------------------------
  // Reads a local .sql file and applies it via {@link pushSql} (no local Docker).
  // Supabase / sanitize options are reserved for a future control-plane import path.
  // ---------------------------------------------------------------------------
  async importSqlFile(
    project: string,
    filePath: string,
    hash: string,
    _options: {
      supabaseCompat: boolean;
      sanitizeForTarget: boolean;
      moveFromPublic: boolean;
      disableRowLevelSecurityInApi?: boolean;
    },
  ): Promise<ImportSqlFileResult> {
    const s = await stat(filePath);
    if (s.size > 4 * 1024 * 1024) {
      throw new Error(
        "SQL file is larger than 4 MiB (server limit for flux push).",
      );
    }
    const sql = await readFile(filePath, "utf8");
    return this.pushSql({ slug: project, hash, sql });
  }

  // ---------------------------------------------------------------------------
  // GET /api/cli/v1/logs?slug=&hash=&service= — Server-Sent Events: { line } / { error }
  // ---------------------------------------------------------------------------
  async streamContainerLogs(
    input: {
      slug: string;
      hash: string;
      service: "api" | "db";
    },
    onEvent: (ev: { line?: string; error?: string }) => void,
    init?: { signal?: AbortSignal },
  ): Promise<void> {
    const token = this.tokenOrThrow();
    const u = new URL(`${this.baseUrl}/cli/v1/logs`);
    u.searchParams.set("slug", input.slug.trim());
    u.searchParams.set("hash", input.hash.trim().toLowerCase());
    u.searchParams.set("service", input.service);
    const res = await fetch(u, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "text/event-stream",
      },
      ...(init?.signal ? { signal: init.signal } : {}),
    });
    if (res.status === 401) {
      throw new Error("Invalid or expired API token. Run `flux login`.");
    }
    if (!res.ok) {
      const t = await res.text();
      let msg = `Request failed (${String(res.status)})`;
      try {
        const j = JSON.parse(t) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        if (t.trim()) msg = t.slice(0, 500);
      }
      throw new Error(msg);
    }
    if (!res.body) {
      throw new Error("CLI logs: empty response body.");
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let carry = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += dec.decode(value, { stream: true });
      const blocks = carry.split("\n\n");
      carry = blocks.pop() ?? "";
      for (const b of blocks) {
        for (const line of b.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const json = line.replace(/^data:\s*/, "").trim();
          if (!json) continue;
          let obj: { line?: string; error?: string };
          try {
            obj = JSON.parse(json) as { line?: string; error?: string };
          } catch {
            continue;
          }
          onEvent(obj);
          if (obj.error) {
            throw new Error(obj.error);
          }
        }
      }
    }
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
  // DELETE /cli/v1/projects/:hash — atomic nuke (see deploy catalog + orphan `force`)
  // ---------------------------------------------------------------------------
  async nukeProject(
    project: string,
    hash: string,
    options?: { forceOrphan?: boolean },
  ): Promise<{ mode: "catalog" | "orphan" }> {
    const token = this.tokenOrThrow();
    const slug = slugifyProjectName(project);
    const u = new URL(
      `${this.baseUrl}/cli/v1/projects/${encodeURIComponent(hash)}`,
    );
    if (options?.forceOrphan) {
      u.searchParams.set("force", "1");
      u.searchParams.set("slug", slug);
    }
    const res = await fetch(u, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = text.trim() ? (JSON.parse(text) as unknown) : null;
    } catch {
      throw new Error(
        `CLI nuke: response was not JSON (${String(res.status)}). Check FLUX_API_BASE.`,
      );
    }
    if (res.status === 401) {
      throw new Error("Invalid or expired API token. Run `flux login`.");
    }
    if (res.status === 404) {
      const errMsg =
        body &&
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof (body as { error: unknown }).error === "string"
          ? (body as { error: string }).error
          : "No project in catalog for this hash";
      const hint =
        !options?.forceOrphan
          ? " If infrastructure still exists without a DB row, run again with: flux nuke --force -y (same name/hash as flux.json)."
          : "";
      throw new Error(`${errMsg}${hint}`);
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
    const parsed = z
      .object({
        ok: z.literal(true),
        mode: z.union([z.literal("catalog"), z.literal("orphan")]),
      })
      .safeParse(body);
    if (!parsed.success) {
      throw new Error("CLI nuke: success response had unexpected shape.");
    }
    return { mode: parsed.data.mode };
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

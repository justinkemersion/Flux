import { FLUX_PROJECT_HASH_HEX_LEN } from "@flux/core";
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
  /** Present on control planes that expose the canonical tenant JWT (same as secrets.pgrstJwtSecret when set). */
  projectJwtSecret: z.string().optional(),
  secrets: createProjectSecretsSchema,
});

const projectCredentialsV2Schema = z.object({
  mode: z.literal("v2_shared"),
  slug: z.string(),
  hash: z.string(),
  projectJwtSecret: z.string(),
  note: z.string(),
});

const projectCredentialsV1Schema = z.object({
  mode: z.literal("v1_dedicated"),
  slug: z.string(),
  hash: z.string(),
  projectJwtSecret: z.string().optional(),
  postgresConnectionString: z.string(),
  anonKey: z.string(),
  serviceRoleKey: z.string(),
});

const projectCredentialsResponseSchema = z.discriminatedUnion("mode", [
  projectCredentialsV2Schema,
  projectCredentialsV1Schema,
]);
const verifyTokenResponseSchema = z.object({
  ok: z.literal(true),
  user: z.string(),
  plan: z.union([z.literal("hobby"), z.literal("pro")]),
  defaultMode: z.union([z.literal("v1_dedicated"), z.literal("v2_shared")]),
});
const projectMetadataSchema = z.object({
  slug: z.string(),
  hash: z.string(),
  mode: z.union([z.literal("v1_dedicated"), z.literal("v2_shared")]),
});

const pushSqlResponseSchema = z.object({
  ok: z.boolean().optional(),
  tablesMoved: z.number(),
  sequencesMoved: z.number(),
  viewsMoved: z.number(),
});

export type CreateProjectSecrets = z.infer<typeof createProjectSecretsSchema>;
export type CreateProjectResult = z.infer<typeof createProjectResponseSchema>;
export type ProjectCredentialsByHash = z.infer<
  typeof projectCredentialsResponseSchema
>;
export type CreateProjectMode = "v1_dedicated" | "v2_shared";
export type VerifyTokenResult = z.infer<typeof verifyTokenResponseSchema>;
export type ProjectMetadata = z.infer<typeof projectMetadataSchema>;

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
  async verifyToken(token: string): Promise<VerifyTokenResult> {
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
    const parsed = verifyTokenResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error("CLI verify: response did not match expected profile shape.");
    }
    return parsed.data;
  }

  async getProjectMetadata(hash: string): Promise<ProjectMetadata> {
    const token = this.tokenOrThrow();
    const h = hash.trim().toLowerCase();
    if (!/^[a-f0-9]{7}$/u.test(h)) {
      throw new Error("Project hash must be a 7-char hex id.");
    }
    const url = `${this.baseUrl}/cli/v1/projects/${encodeURIComponent(h)}`;
    const res = await fetch(url, {
      method: "GET",
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
        `CLI project metadata: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
      );
    }
    if (res.status === 401) {
      throw new Error("Invalid or expired API token. Run `flux login`.");
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
    const parsed = projectMetadataSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(
        "CLI project metadata: response did not match expected { slug, hash, mode } shape.",
      );
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
  // POST /api/cli/v1/create — body: { name, stripSupabaseRestPrefix?, mode? }
  // ---------------------------------------------------------------------------
  async createProject(input: {
    name: string;
    stripSupabaseRestPrefix: boolean;
    mode?: CreateProjectMode;
  }): Promise<CreateProjectResult> {
    const token = this.tokenOrThrow();
    const url = `${this.baseUrl}/cli/v1/create`;
    const body: {
      name: string;
      stripSupabaseRestPrefix?: boolean;
      mode?: CreateProjectMode;
    } = {
      name: input.name.trim(),
    };
    if (input.stripSupabaseRestPrefix === false) {
      body.stripSupabaseRestPrefix = false;
    }
    if (input.mode) {
      body.mode = input.mode;
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
  // GET /api/cli/v1/projects/:hash/credentials — tenant JWT (v2) or full v1 secrets
  // ---------------------------------------------------------------------------
  async getProjectCredentialsByHash(
    hash: string,
  ): Promise<ProjectCredentialsByHash> {
    const token = this.tokenOrThrow();
    const h = hash.trim().toLowerCase();
    const hexLen = FLUX_PROJECT_HASH_HEX_LEN;
    if (h.length !== hexLen || !/^[a-f0-9]+$/u.test(h)) {
      throw new Error(
        `Project hash must be a ${String(hexLen)}-character lowercase hex id.`,
      );
    }
    const url = `${this.baseUrl}/cli/v1/projects/${encodeURIComponent(h)}/credentials`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    const text = await res.text();
    let raw: unknown;
    try {
      raw = text.trim() ? (JSON.parse(text) as unknown) : null;
    } catch {
      throw new Error(
        `CLI credentials: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
      );
    }
    if (res.status === 401) {
      throw new Error("Invalid or expired API token. Run `flux login`.");
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
    const parsed = projectCredentialsResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        "CLI credentials: response did not match expected credentials shape.",
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
  // POST /cli/v1/projects/:hash/lifecycle — { action: "start" | "stop" }
  // ---------------------------------------------------------------------------
  private async runLifecycle(
    project: string,
    hash: string,
    action: "start" | "stop",
  ): Promise<void> {
    const token = this.tokenOrThrow();
    const h = hash.trim().toLowerCase();
    const url = `${this.baseUrl}/cli/v1/projects/${encodeURIComponent(
      h,
    )}/lifecycle`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action }),
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = text.trim() ? (JSON.parse(text) as unknown) : null;
    } catch {
      throw new Error(
        `CLI lifecycle: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
      );
    }
    if (res.status === 401) {
      throw new Error("Invalid or expired API token. Run `flux login`.");
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
  }

  async stopProject(project: string, hash: string): Promise<void> {
    await this.runLifecycle(project, hash, "stop");
  }

  async startProject(project: string, hash: string): Promise<void> {
    await this.runLifecycle(project, hash, "start");
  }

  // ---------------------------------------------------------------------------
  // GET /cli/v1/projects/:hash/dump?schemaOnly=&dataOnly=&clean=&publicOnly=
  // ---------------------------------------------------------------------------
  async getProjectDumpStream(input: {
    hash: string;
    schemaOnly?: boolean;
    dataOnly?: boolean;
    clean?: boolean;
    publicOnly?: boolean;
  }): Promise<ReadableStream<Uint8Array>> {
    if (input.schemaOnly === true && input.dataOnly === true) {
      throw new Error("schema-only and data-only cannot both be enabled.");
    }
    const token = this.tokenOrThrow();
    const hash = input.hash.trim().toLowerCase();
    const u = new URL(`${this.baseUrl}/cli/v1/projects/${encodeURIComponent(hash)}/dump`);
    if (input.schemaOnly === true) u.searchParams.set("schemaOnly", "1");
    if (input.dataOnly === true) u.searchParams.set("dataOnly", "1");
    if (input.clean === true) u.searchParams.set("clean", "1");
    if (input.publicOnly === true) u.searchParams.set("publicOnly", "1");

    const res = await fetch(u, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 401) {
      throw new Error("Invalid or expired API token. Run `flux login`.");
    }
    if (!res.ok) {
      const text = await res.text();
      let msg = `Request failed (${String(res.status)})`;
      try {
        const j = JSON.parse(text) as { error?: unknown };
        if (typeof j.error === "string" && j.error.trim().length > 0) {
          msg = j.error;
        }
      } catch {
        if (text.trim().length > 0) msg = text.trim().slice(0, 500);
      }
      throw new Error(msg);
    }
    if (!res.body) {
      throw new Error("CLI dump: empty response body.");
    }
    return res.body;
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
  async listProjectEnv(
    project: string,
    hash: string,
  ): Promise<FluxProjectEnvEntry[]> {
    const token = this.tokenOrThrow();
    const slug = slugifyProjectName(project);
    const u = new URL(
      `${this.baseUrl}/cli/v1/projects/${encodeURIComponent(hash)}/api-env`,
    );
    u.searchParams.set("slug", slug);
    const res = await fetch(u, {
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
        `CLI env list: response was not JSON (${String(res.status)}). Check FLUX_API_BASE.`,
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
    const schema = z.array(
      z.union([
        z.object({
          key: z.string(),
          sensitive: z.literal(true),
        }),
        z.object({
          key: z.string(),
          value: z.string(),
          sensitive: z.literal(false),
        }),
      ]),
    );
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new Error(
        "CLI env list: response did not match expected env entry shape.",
      );
    }
    return parsed.data;
  }

  // ---------------------------------------------------------------------------
  // PATCH /projects/{slug}/api-env?hash= — partial env map
  // ---------------------------------------------------------------------------
  async setProjectEnv(
    project: string,
    env: Record<string, string>,
    hash: string,
  ): Promise<void> {
    const token = this.tokenOrThrow();
    const slug = slugifyProjectName(project);
    const u = new URL(
      `${this.baseUrl}/cli/v1/projects/${encodeURIComponent(hash)}/api-env`,
    );
    u.searchParams.set("slug", slug);
    const res = await fetch(u, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ env }),
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
        `CLI env set: response was not JSON (${String(res.status)}). Check FLUX_API_BASE.`,
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

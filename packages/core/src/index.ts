import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import Docker from "dockerode";
import jwt from "jsonwebtoken";
import pg from "pg";

import {
  API_SCHEMA_PRIVILEGES_SQL,
  DISABLE_ROW_LEVEL_SECURITY_FOR_RLS_ENABLED_API_TABLES_SQL,
} from "./api-schema-privileges.ts";
import {
  materializePreparedSqlFile,
  queryPostgresMajorVersion,
  type ImportSqlFileOptions,
} from "./import-dump.ts";
import { runMovePublicToApiWithClient } from "./schema-move-public-to-api.ts";
import { runTenantPsqlFile } from "./run-tenant-psql-file.ts";

export type { ImportSqlFileOptions } from "./import-dump.ts";
export type { MovePublicToApiResult } from "./schema-move-public-to-api.ts";

export type ImportSqlFileResult = {
  tablesMoved: number;
  sequencesMoved: number;
  viewsMoved: number;
};
export {
  applySupabaseCompatibilityTransforms,
  preparePlainSqlDumpForFlux,
  queryPostgresMajorVersion,
  sanitizePlainSqlDumpForPostgresMajor,
} from "./import-dump.ts";
export {
  API_SCHEMA_PRIVILEGES_SQL,
  DISABLE_ROW_LEVEL_SECURITY_FOR_RLS_ENABLED_API_TABLES_SQL,
} from "./api-schema-privileges.ts";

export const FLUX_NETWORK_NAME = "flux-network";

/** Traefik gateway container (Docker provider, host :80 → entrypoint `web`). */
export const FLUX_GATEWAY_CONTAINER_NAME = "flux-gateway";

/** Pinned images for Flux project stacks (Postgres + PostgREST + Traefik). */
export const FLUX_DOCKER_IMAGES = {
  postgres: "postgres:16-alpine",
  postgrest: "postgrest/postgrest:latest",
  /** v3.6+ negotiates Docker API version (v3.0 used API 1.24 and breaks on modern Engine). */
  traefik: "traefik:v3.6",
} as const;

const POSTGRES_IMAGE = FLUX_DOCKER_IMAGES.postgres;
const POSTGREST_IMAGE = FLUX_DOCKER_IMAGES.postgrest;
const TRAEFIK_IMAGE = FLUX_DOCKER_IMAGES.traefik;

/** Default superuser when only `POSTGRES_PASSWORD` is set on official images. */
const POSTGRES_USER = "postgres";

/**
 * One-time SQL run against every new Flux project database.
 *
 * Sets up the `api` schema and three roles that PostgREST expects:
 *   authenticator — the login role PostgREST connects as (no direct login for users)
 *   anon          — privileges for unauthenticated requests
 *   authenticated — privileges for JWT-verified requests
 *
 * Also grants on existing tables/sequences and sets ALTER DEFAULT PRIVILEGES so future objects in
 * `api` automatically grant DML to `anon` / `authenticated`, plus sequence USAGE for serial IDs.
 * Default privileges for objects created by `postgres` (typical migration role) ensure new tables
 * and sequences stay visible to PostgREST roles without manual GRANTs.
 */
export const BOOTSTRAP_SQL = `
-- Schema that PostgREST will expose (default: first entry of PGRST_DB_SCHEMAS=api,public)
CREATE SCHEMA IF NOT EXISTS api;

-- Role that PostgREST connects as; cannot log in directly
DO $$ BEGIN
  CREATE ROLE authenticator NOINHERIT NOCREATEDB NOCREATEROLE NOSUPERUSER;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Roles that requests run as after JWT validation
DO $$ BEGIN
  CREATE ROLE anon NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE ROLE authenticated NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Allow authenticator to switch to request roles
GRANT anon          TO authenticator;
GRANT authenticated TO authenticator;

${API_SCHEMA_PRIVILEGES_SQL}
`.trim();

function randomHexChars(byteLength: number): string {
  return randomBytes(byteLength).toString("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => {
    ctrl.abort();
  }, ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => {
    clearTimeout(t);
  });
}

/**
 * Polls `url` until the gateway returns HTTP (not connection errors / gateway timeouts).
 * Used after provision so we do not report success while Traefik or PostgREST are still starting.
 */
async function waitForApiReachable(
  url: string,
  options?: { maxAttempts?: number; onStatus?: (message: string) => void },
): Promise<void> {
  const maxAttempts = options?.maxAttempts ?? 40;
  const onStatus = options?.onStatus;
  let attempt = 0;
  onStatus?.(`Checking ${url} (gateway + PostgREST)…`);

  while (true) {
    attempt++;
    try {
      const res = await fetchWithTimeout(url, 8000);
      const transient =
        res.status === 502 || res.status === 503 || res.status === 504;
      if (!transient) {
        onStatus?.("API URL responded.");
        return;
      }
    } catch {
      /* connection refused, DNS, reset — retry */
    }
    if (attempt >= maxAttempts) {
      throw new Error(
        `API URL ${url} did not become reachable after ${String(maxAttempts)} attempts (check Traefik and PostgREST).`,
      );
    }
    if (attempt === 1 || attempt % 5 === 0) {
      onStatus?.(
        `Still waiting for ${url} (attempt ${String(attempt)}/${String(maxAttempts)})…`,
      );
    }
    await sleep(Math.min(400 * 2 ** Math.min(attempt, 5), 5000));
  }
}

/**
 * Opens a one-shot pg connection to `localhost:{hostPort}`, runs `sql`, then closes.
 * Throws if the query fails.
 */
async function runSql(
  hostPort: number,
  password: string,
  sql: string,
): Promise<void> {
  const client = new pg.Client({
    host: "localhost",
    port: hostPort,
    user: POSTGRES_USER,
    password,
    database: "postgres",
    connectionTimeoutMillis: 3000,
  });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

/**
 * Polls Postgres on `localhost:{hostPort}` until it accepts connections, then runs `sql`.
 * Uses exponential back-off; gives up after `maxAttempts`.
 */
async function waitForPostgresAndRun(
  hostPort: number,
  password: string,
  sql: string,
  options?: {
    maxAttempts?: number;
    onStatus?: (message: string) => void;
  },
): Promise<void> {
  const maxAttempts = options?.maxAttempts ?? 20;
  const onStatus = options?.onStatus;
  let attempt = 0;
  onStatus?.(
    "Waiting for Postgres to accept connections (initializing a new data directory can take 30–90s)…",
  );
  while (true) {
    try {
      await runSql(hostPort, password, sql);
      onStatus?.("Postgres is up; bootstrap SQL applied.");
      return;
    } catch (err: unknown) {
      attempt++;
      if (attempt >= maxAttempts) {
        throw new Error(
          `Postgres on port ${hostPort} was not ready after ${maxAttempts} attempts: ${String(err)}`,
        );
      }
      if (attempt === 1 || attempt % 3 === 0) {
        onStatus?.(
          `Postgres not ready yet (attempt ${String(attempt)}/${String(maxAttempts)}); retrying…`,
        );
      }
      const backoff = Math.min(500 * 2 ** attempt, 8000);
      await sleep(backoff);
    }
  }
}

function getHttpStatus(err: unknown): number | undefined {
  if (err && typeof err === "object" && "statusCode" in err) {
    const code = (err as { statusCode?: number }).statusCode;
    return typeof code === "number" ? code : undefined;
  }
  return undefined;
}

/** Parses Docker `Config.Env` entries (`KEY=value`, first `=` splits). */
function envRecordFromDockerEnv(env: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of env ?? []) {
    const i = line.indexOf("=");
    if (i <= 0) continue;
    out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

function dockerEnvFromRecord(record: Record<string, string>): string[] {
  return Object.keys(record)
    .sort((a, b) => a.localeCompare(b))
    .map((k) => `${k}=${record[k] ?? ""}`);
}

/**
 * Reads `PGRST_JWT_SECRET` from `inspect.Config.Env` only — never generates or substitutes a secret.
 */
function readPgrstJwtSecretFromContainerEnv(
  inspect: { Config?: { Env?: string[] } },
  apiName: string,
): string {
  const rawEnv = inspect.Config?.Env;
  if (rawEnv == null || rawEnv.length === 0) {
    throw new Error(
      `Container "${apiName}" has no Config.Env; cannot align JWT keys with PostgREST.`,
    );
  }
  const entry = rawEnv.find((line) => line.startsWith("PGRST_JWT_SECRET="));
  if (entry === undefined) {
    throw new Error(
      `PGRST_JWT_SECRET is missing from container "${apiName}" (inspect.Config.Env).`,
    );
  }
  const secret = entry.slice("PGRST_JWT_SECRET=".length);
  if (!secret) {
    throw new Error(
      `PGRST_JWT_SECRET is empty on container "${apiName}"; refusing to mint ad-hoc signing keys.`,
    );
  }
  return secret;
}

/**
 * Whether an env var name should not have its **value** printed (e.g. `flux env list`).
 * Heuristic: connection strings, JWT material, passwords, and typical secret/token names.
 */
export function isFluxSensitiveEnvKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (lower === "pgrst_db_uri" || lower === "pgrst_jwt_secret") return true;
  if (lower.includes("password") || lower.includes("passwd")) return true;
  if (lower.includes("secret") && !lower.includes("publishable")) return true;
  if (/_token$|_tokens$/i.test(key)) return true;
  if (lower.includes("private_key") || lower.includes("privatekey")) return true;
  if (/_api_key$/i.test(key) && !lower.includes("publishable")) return true;
  return false;
}

/** One row for {@link ProjectManager.listProjectEnv}. */
export type FluxProjectEnvEntry =
  | { key: string; sensitive: true }
  | { key: string; value: string; sensitive: false };

function slugifyProjectName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) {
    throw new Error(
      `Invalid project name "${name}": use letters, numbers, or separators`,
    );
  }
  return slug;
}

function postgresContainerName(slug: string): string {
  return `flux-${slug}-db`;
}

function postgrestContainerName(slug: string): string {
  return `flux-${slug}-api`;
}

/** HTTP origin for a tenant API as routed by {@link FLUX_GATEWAY_CONTAINER_NAME} (Traefik). */
export function fluxApiUrlForSlug(slug: string): string {
  return `http://${slug}.flux.localhost`;
}

/**
 * Traefik v3 `Host()` matcher: backticks wrap the literal hostname (required syntax).
 * Example for slug `acme`: `Host(\`acme.flux.localhost\`)`.
 */
function traefikHostRule(slug: string): string {
  return `Host(\`${slug}.flux.localhost\`)`;
}

/** Shared Traefik middleware names (repeated on each PostgREST container; Traefik merges identical defs). */
const TRAEFIK_MW_STRIP_PREFIX = "flux-stripprefix";
/** CORS for local dev (e.g. YeastCoast on port 3001 → `*.flux.localhost`). */
const TRAEFIK_MW_CORS_LOCALHOST_3001 = "flux-cors-localhost-3001";

/** Supabase JS + PostgREST (explicit list; no wildcard). */
const TRAEFIK_CORS_ALLOW_HEADERS =
  "apikey,Authorization,Content-Type,X-Client-Info,Accept-Profile,Content-Profile,Prefer,Accept,Range";

/** PostgREST `db-schemas`: default `api`; include `public` for Supabase-style dumps. */
const PGRST_DB_SCHEMAS_VALUE = "api,public";

/** Traefik labels for the tenant PostgREST router (shared by provision and label updates). */
function postgrestTraefikDockerLabels(
  slug: string,
  stripSupabaseRestPrefix: boolean,
): Record<string, string> {
  const traefikSvc = `flux-${slug}-api`;
  const labels: Record<string, string> = {
    "traefik.enable": "true",
    "traefik.docker.network": FLUX_NETWORK_NAME,
    [`traefik.http.routers.${traefikSvc}.rule`]: traefikHostRule(slug),
    [`traefik.http.routers.${traefikSvc}.entrypoints`]: "web",
    [`traefik.http.routers.${traefikSvc}.service`]: traefikSvc,
    [`traefik.http.services.${traefikSvc}.loadbalancer.server.port`]: "3000",
  };

  labels[`traefik.http.middlewares.${TRAEFIK_MW_STRIP_PREFIX}.stripprefix.prefixes`] =
    "/rest/v1";

  labels[
    `traefik.http.middlewares.${TRAEFIK_MW_CORS_LOCALHOST_3001}.headers.accesscontrolalloworiginlist`
  ] = "http://localhost:3001";
  labels[
    `traefik.http.middlewares.${TRAEFIK_MW_CORS_LOCALHOST_3001}.headers.accesscontrolallowmethods`
  ] = "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD";
  labels[
    `traefik.http.middlewares.${TRAEFIK_MW_CORS_LOCALHOST_3001}.headers.accesscontrolallowheaders`
  ] = TRAEFIK_CORS_ALLOW_HEADERS;
  labels[
    `traefik.http.middlewares.${TRAEFIK_MW_CORS_LOCALHOST_3001}.headers.accesscontrolmaxage`
  ] = "86400";
  labels[
    `traefik.http.middlewares.${TRAEFIK_MW_CORS_LOCALHOST_3001}.headers.addvaryheader`
  ] = "true";

  const middlewares = stripSupabaseRestPrefix
    ? `${TRAEFIK_MW_CORS_LOCALHOST_3001},${TRAEFIK_MW_STRIP_PREFIX}`
    : TRAEFIK_MW_CORS_LOCALHOST_3001;
  labels[`traefik.http.routers.${traefikSvc}.middlewares`] = middlewares;

  return labels;
}

/**
 * Strips Flux’s Traefik routing labels for this tenant’s API so they can be replaced (toggle strip).
 * Preserves unrelated Docker labels on the same container.
 */
function removeFluxPostgrestTraefikDockerLabels(
  existing: Record<string, string>,
  slug: string,
): Record<string, string> {
  const traefikSvc = `flux-${slug}-api`;
  const sharedMwPrefixes = [
    `traefik.http.middlewares.${TRAEFIK_MW_STRIP_PREFIX}`,
    `traefik.http.middlewares.${TRAEFIK_MW_CORS_LOCALHOST_3001}`,
    `traefik.http.middlewares.flux-${slug}-supabase-rest-strip`,
  ];
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(existing)) {
    if (k === "traefik.enable") continue;
    if (k === "traefik.docker.network") continue;
    if (k.startsWith(`traefik.http.routers.${traefikSvc}.`)) continue;
    if (k.startsWith(`traefik.http.services.${traefikSvc}.`)) continue;
    if (sharedMwPrefixes.some((p) => k.startsWith(p))) continue;
    out[k] = v;
  }
  return out;
}

function mergedPostgrestTraefikDockerLabels(
  existing: Record<string, string>,
  slug: string,
  stripSupabaseRestPrefix: boolean,
): Record<string, string> {
  return {
    ...removeFluxPostgrestTraefikDockerLabels(existing, slug),
    ...postgrestTraefikDockerLabels(slug, stripSupabaseRestPrefix),
  };
}

function containerNameForProject(projectName: string): string {
  return postgresContainerName(slugifyProjectName(projectName));
}

function hostPortForTcp(
  inspect: {
    NetworkSettings: { Ports?: Record<string, Array<{ HostPort?: string }> | null> };
  },
  containerPort: "5432/tcp" | "3000/tcp",
): number {
  const bindings = inspect.NetworkSettings.Ports?.[containerPort];
  const hostPort = bindings?.[0]?.HostPort;
  if (!hostPort) {
    throw new Error(`Expected a published host port for ${containerPort}`);
  }
  return Number.parseInt(hostPort, 10);
}

function tenantVolumeName(slug: string): string {
  return `flux-${slug}-db-data`;
}

/** Flux tenant container name pattern: flux-&lt;slug&gt;-db | flux-&lt;slug&gt;-api */
const FLUX_TENANT_CONTAINER = /^flux-(.+)-(db|api)$/;

/** If a pull emits no progress for this long, fail (slow or stuck network). */
const DOCKER_PULL_STALL_MS = 120_000;

/** How often we check for a stalled pull. */
const DOCKER_PULL_STALL_CHECK_MS = 2_000;

type PullProgressMap = Map<string, { current: number; total: number }>;

function aggregatedPullPercent(layers: PullProgressMap): number {
  let sumCurrent = 0;
  let sumTotal = 0;
  for (const { current, total } of layers.values()) {
    if (total > 0) {
      sumCurrent += Math.min(current, total);
      sumTotal += total;
    }
  }
  if (sumTotal === 0) return 0;
  return Math.min(100, (100 * sumCurrent) / sumTotal);
}

/**
 * Consumes a Docker Engine pull JSON stream: handles `error` / `end`, detects stalls, and logs ~10% steps.
 */
async function consumeDockerPullStream(
  stream: Readable,
  ctx: { image: string; onStatus?: (message: string) => void },
): Promise<void> {
  const { image, onStatus } = ctx;
  const layers: PullProgressMap = new Map();
  let buffer = "";
  let lastActivity = Date.now();
  let lastDecileLogged = -1;

  const touch = (): void => {
    lastActivity = Date.now();
  };

  const maybeLogDecile = (): void => {
    const pct = aggregatedPullPercent(layers);
    const decile = Math.min(10, Math.floor(pct / 10));
    if (decile > lastDecileLogged) {
      lastDecileLogged = decile;
      onStatus?.(`Pull ${image}: ~${String(decile * 10)}%`);
    }
  };

  const stallTimer = setInterval(() => {
    if (Date.now() - lastActivity >= DOCKER_PULL_STALL_MS) {
      stream.destroy(
        new Error(
          `Docker image pull stalled: no progress for ${String(DOCKER_PULL_STALL_MS / 1000)}s while pulling ${image}`,
        ),
      );
    }
  }, DOCKER_PULL_STALL_CHECK_MS);

  const cleanup = (): void => {
    clearInterval(stallTimer);
  };

  const onLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let row: unknown;
    try {
      row = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      touch();
      return;
    }
    touch();
    if (!row || typeof row !== "object") return;
    const o = row as Record<string, unknown>;
    const detail = o.progressDetail as { current?: number; total?: number } | undefined;
    if (
      detail &&
      typeof detail.current === "number" &&
      typeof detail.total === "number"
    ) {
      const id =
        typeof o.id === "string" && o.id.length > 0 ? o.id : "__aggregate__";
      layers.set(id, { current: detail.current, total: detail.total });
      maybeLogDecile();
    } else if (typeof o.status === "string") {
      if (lastDecileLogged < 0) {
        lastDecileLogged = 0;
        onStatus?.(`Pull ${image}: ~0% (${o.status})`);
      }
    }
  };

  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      stream.removeListener("data", onData);
      stream.removeListener("error", onError);
      stream.removeListener("end", onEnd);
      fn();
    };

    const onError = (err: unknown): void => {
      settle(() => {
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    };

    const onEnd = (): void => {
      try {
        touch();
        if (buffer.trim()) onLine(buffer);
        buffer = "";
        if (lastDecileLogged < 10) {
          lastDecileLogged = 10;
          onStatus?.(`Pull ${image}: ~100%`);
        }
        settle(() => resolve());
      } catch (err: unknown) {
        settle(() => {
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      }
    };

    const onData = (chunk: Buffer | string): void => {
      try {
        touch();
        buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) onLine(part);
      } catch (err: unknown) {
        settle(() => {
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      }
    };

    stream.on("data", onData);
    stream.on("error", onError);
    stream.on("end", onEnd);
  });
}

/** Row returned by {@link ProjectManager.listProjects}. */
export interface FluxProjectSummary {
  /** Normalized project slug (from container names). */
  slug: string;
  /** Combined health of Postgres + PostgREST containers. */
  status: "running" | "stopped" | "partial";
  /** Public API URL via the Flux Traefik gateway (`Host: {slug}.flux.localhost`). */
  apiUrl: string;
}

/** Catalog row from the flux-system `projects` table (control-plane metadata DB). */
export interface FluxSystemProjectActivity {
  id: string;
  name: string;
  slug: string;
  lastActiveAt: Date;
  /** `true` when {@link FluxSystemProjectActivity.lastActiveAt} is older than `maxAgeDays` passed to {@link ProjectManager.stopInactiveProjects}. */
  inactiveByPolicy: boolean;
}

async function ensureImage(
  docker: Docker,
  image: string,
  onStatus?: (message: string) => void,
): Promise<void> {
  try {
    await docker.getImage(image).inspect();
    onStatus?.(`Image ${image} is already present locally.`);
  } catch {
    onStatus?.(`Pulling ${image} (stall timeout ${String(DOCKER_PULL_STALL_MS / 1000)}s without progress)…`);
    const stream = (await docker.pull(image)) as Readable;
    await consumeDockerPullStream(
      stream,
      onStatus ? { image, onStatus } : { image },
    );
    onStatus?.(`Finished pulling ${image}.`);
  }
}

async function ensureNamedVolume(docker: Docker, name: string): Promise<void> {
  try {
    await docker.createVolume({ Name: name });
  } catch (err: unknown) {
    if (getHttpStatus(err) === 409) return;
    throw err;
  }
}

function postgresJdbcUri(slug: string, password: string): string {
  const host = postgresContainerName(slug);
  const user = encodeURIComponent(POSTGRES_USER);
  const pass = encodeURIComponent(password);
  return `postgres://${user}:${pass}@${host}:5432/postgres`;
}

/** Connection URI for tools on the Docker host (`localhost` published port). */
function postgresHostConnectionUri(hostPort: number, password: string): string {
  const user = encodeURIComponent(POSTGRES_USER);
  const pass = encodeURIComponent(password);
  return `postgres://${user}:${pass}@127.0.0.1:${String(hostPort)}/postgres`;
}

export async function createProjectBucket(
  projectName: string,
  dbPassword: string,
): Promise<{ containerId: string; hostPort: number }> {
  const docker = new Docker();
  const name = containerNameForProject(projectName);

  await ensureImage(docker, POSTGRES_IMAGE);

  try {
    const container = await docker.createContainer({
      name,
      Image: POSTGRES_IMAGE,
      Env: [`POSTGRES_PASSWORD=${dbPassword}`],
      ExposedPorts: { "5432/tcp": {} },
      HostConfig: {
        PortBindings: {
          "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "0" }],
        },
        Memory: 512 * 1024 * 1024,
      },
    });
    await container.start();
    const inspect = await container.inspect();
    return { containerId: inspect.Id, hostPort: hostPortForTcp(inspect, "5432/tcp") };
  } catch (err: unknown) {
    const statusCode = getHttpStatus(err);
    if (statusCode !== 409) throw err;

    const existing = await docker.listContainers({
      all: true,
      filters: { name: [name] },
    });
    const match = existing.find((c) =>
      c.Names?.some((n) => n === `/${name}` || n === name),
    );
    if (!match) throw err;

    const container = docker.getContainer(match.Id);
    if (match.State !== "running") {
      await container.start();
    }
    const inspect = await container.inspect();
    return { containerId: inspect.Id, hostPort: hostPortForTcp(inspect, "5432/tcp") };
  }
}

/** Describes a fully provisioned Flux tenant: DB + PostgREST on the shared bridge network. */
export interface FluxProject {
  /** Display name supplied to `provisionProject`. */
  name: string;
  /** Normalized identifier used in container names (e.g. `my-app` → `flux-my-app-db`). */
  slug: string;
  /** User-defined bridge all project containers attach to (e.g. `flux-network`). */
  networkName: string;
  postgres: {
    containerId: string;
    /** Resolvable hostname on `networkName` (Docker DNS: same as container name). */
    containerName: string;
    /** Host port mapped to 5432 when published (omit if only internal access). */
    hostPort?: number;
  };
  postgrest: {
    containerId: string;
    containerName: string;
  };
  /** Public PostgREST base URL via Traefik (no per-tenant host port). */
  apiUrl: string;
  /** Secret PostgREST uses for JWT verification (generated or from {@link ProvisionOptions.customJwtSecret}). */
  jwtSecret: string;
  /** Generated Postgres superuser password — treat as sensitive. */
  postgresPassword: string;
  /**
   * When true, the gateway chains CORS + `flux-stripprefix` for `/rest/v1` (see {@link ProvisionOptions.stripSupabaseRestPrefix}).
   */
  stripSupabaseRestPrefix: boolean;
}

/** Optional hooks for long-running {@link ProjectManager.provisionProject} work (CLIs, logs). */
export interface ProvisionOptions {
  onStatus?: (message: string) => void;
  /**
   * When set (e.g. Clerk or NextAuth JWT signing secret), used as `PGRST_JWT_SECRET` for PostgREST
   * so the tenant API can verify tokens minted by your auth provider. If omitted, a random secret is generated.
   */
  customJwtSecret?: string;
  /**
   * When true (default), the tenant router chains CORS (localhost:3001) and the shared
   * `flux-stripprefix` middleware so the Supabase JS client’s `/rest/v1` path reaches PostgREST.
   * Set to false only if clients call PostgREST at the URL root with no `/rest/v1` prefix.
   */
  stripSupabaseRestPrefix?: boolean;
}

/** Required for {@link ProjectManager.nukeProject} — confirms permanent data loss. */
export interface NukeProjectOptions {
  acknowledgeDataLoss: true;
}

/**
 * Orchestrates Docker resources for Flux projects: shared network, Postgres, PostgREST.
 */
export class ProjectManager {
  private readonly docker: Docker;

  constructor(docker?: Docker) {
    this.docker = docker ?? new Docker();
  }

  /** Docker DNS names for Postgres and PostgREST on {@link FLUX_NETWORK_NAME} (internal connectivity). */
  static containerNamesForSlug(slug: string): {
    postgres: string;
    postgrest: string;
  } {
    return {
      postgres: postgresContainerName(slug),
      postgrest: postgrestContainerName(slug),
    };
  }

  /**
   * Provisions Postgres + PostgREST on {@link FLUX_NETWORK_NAME}, with internal DNS between services.
   *
   * The shared {@link FLUX_GATEWAY_CONTAINER_NAME} Traefik instance (started with the Flux network)
   * routes `http://{slug}.flux.localhost` to PostgREST via Docker labels; PostgREST is not published
   * on a random host port. By default, Traefik chains a Headers (CORS) middleware for
   * `http://localhost:3001` and the shared `flux-stripprefix` middleware for `/rest/v1` (Supabase JS).
   * Disable strip with {@link ProvisionOptions.stripSupabaseRestPrefix} `false` if clients use PostgREST at the URL root only.
   *
   * PostgREST is started with RestartPolicy `on-failure` (with a retry cap) so it survives Postgres
   * startup races without a Node-side health probe; a short delay after Postgres start reduces churn
   * during first-time volume initialization.
   */
  async provisionProject(
    name: string,
    options?: ProvisionOptions,
  ): Promise<FluxProject> {
    const log = options?.onStatus;
    await this.ensureFluxNetwork(log);
    await this.ensureFluxGateway(log);
    const slug = slugifyProjectName(name);
    const postgresPassword = randomHexChars(16);
    const trimmedCustomJwt = options?.customJwtSecret?.trim();
    const jwtSecret =
      trimmedCustomJwt && trimmedCustomJwt.length > 0
        ? trimmedCustomJwt
        : randomHexChars(32);

    const volumeName = tenantVolumeName(slug);
    const pgContainerName = postgresContainerName(slug);
    const apiContainerName = postgrestContainerName(slug);

    log?.(`Ensuring volume ${volumeName}…`);
    await ensureNamedVolume(this.docker, volumeName);
    log?.("Ensuring container images…");
    await ensureImage(this.docker, POSTGRES_IMAGE, log);
    await ensureImage(this.docker, POSTGREST_IMAGE, log);

    let pgContainer: Docker.Container;
    log?.(`Creating Postgres container ${pgContainerName}…`);
    try {
      pgContainer = await this.docker.createContainer({
        name: pgContainerName,
        Image: POSTGRES_IMAGE,
        Env: [`POSTGRES_PASSWORD=${postgresPassword}`],
        ExposedPorts: { "5432/tcp": {} },
        HostConfig: {
          NetworkMode: FLUX_NETWORK_NAME,
          Binds: [`${volumeName}:/var/lib/postgresql/data`],
          PortBindings: {
            "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "0" }],
          },
          Memory: 512 * 1024 * 1024,
          RestartPolicy: { Name: "unless-stopped" },
        },
      });
    } catch (err: unknown) {
      if (getHttpStatus(err) === 409) {
        throw new Error(
          `A Flux project already exists for this name (container "${pgContainerName}").`,
        );
      }
      throw err;
    }

    log?.("Starting Postgres…");
    await pgContainer.start();
    const pgInspect = await pgContainer.inspect();
    const postgresHostPort = hostPortForTcp(pgInspect, "5432/tcp");

    await waitForPostgresAndRun(
      postgresHostPort,
      postgresPassword,
      BOOTSTRAP_SQL,
      log ? { onStatus: log } : undefined,
    );

    const dbUri = postgresJdbcUri(slug, postgresPassword);

    const stripSupabaseRestPrefix = options?.stripSupabaseRestPrefix !== false;
    const traefikLabels = postgrestTraefikDockerLabels(
      slug,
      stripSupabaseRestPrefix,
    );

    let apiContainer: Docker.Container;
    log?.(`Creating PostgREST container ${apiContainerName}…`);
    try {
      apiContainer = await this.docker.createContainer({
        name: apiContainerName,
        Image: POSTGREST_IMAGE,
        Labels: traefikLabels,
        Env: [
          `PGRST_DB_URI=${dbUri}`,
          `PGRST_JWT_SECRET=${jwtSecret}`,
          `PGRST_DB_SCHEMAS=${PGRST_DB_SCHEMAS_VALUE}`,
          `PGRST_DB_ANON_ROLE=anon`,
        ],
        ExposedPorts: { "3000/tcp": {} },
        HostConfig: {
          NetworkMode: FLUX_NETWORK_NAME,
          Memory: 256 * 1024 * 1024,
          RestartPolicy: { Name: "on-failure", MaximumRetryCount: 25 },
        },
      });
    } catch (err: unknown) {
      if (getHttpStatus(err) === 409) {
        throw new Error(
          `A Flux project already exists for this name (container "${apiContainerName}").`,
        );
      }
      throw err;
    }

    log?.("Starting PostgREST…");
    await apiContainer.start();
    const apiInspect = await apiContainer.inspect();
    await this.ensureContainerAttachedToFluxNetwork(apiInspect.Id);
    log?.(
      `Verified PostgREST container is attached to ${FLUX_NETWORK_NAME} (Traefik can reach it).`,
    );

    const apiUrl = fluxApiUrlForSlug(slug);
    await waitForApiReachable(apiUrl, log ? { onStatus: log } : undefined);

    log?.("Provision complete.");
    return {
      name,
      slug,
      networkName: FLUX_NETWORK_NAME,
      postgres: {
        containerId: pgInspect.Id,
        containerName: pgContainerName,
        hostPort: postgresHostPort,
      },
      postgrest: {
        containerId: apiInspect.Id,
        containerName: apiContainerName,
      },
      apiUrl,
      jwtSecret,
      postgresPassword,
      stripSupabaseRestPrefix,
    };
  }

  /**
   * Merges `envs` into the PostgREST/API container’s existing `Config.Env`, recreates the
   * container (same image, Traefik labels, network, limits), and starts it if it was running
   * so new variables (e.g. custom app config) take effect.
   */
  async setProjectEnv(slug: string, envs: Record<string, string>): Promise<void> {
    const normalized = slugifyProjectName(slug);
    const existing = await this.getPostgrestInspectOrThrow(normalized);
    const merged = {
      ...envRecordFromDockerEnv(existing.Config.Env),
      ...envs,
    };
    await this.replacePostgrestApiContainer(normalized, existing, merged);
  }

  /**
   * Recreates the PostgREST container with updated Traefik labels so the gateway strips `/rest/v1`
   * before forwarding to PostgREST (required for the Supabase JS client’s default REST path), or
   * removes that middleware when `enabled` is false.
   */
  async setPostgrestSupabaseRestPrefix(
    projectName: string,
    enabled: boolean,
  ): Promise<void> {
    const slug = slugifyProjectName(projectName);
    const existing = await this.getPostgrestInspectOrThrow(slug);
    const merged = envRecordFromDockerEnv(existing.Config.Env);
    const labels = mergedPostgrestTraefikDockerLabels(
      existing.Config.Labels ?? {},
      slug,
      enabled,
    );
    await this.replacePostgrestApiContainer(slug, existing, merged, {
      labels,
    });
  }

  /**
   * Returns env entries from the PostgREST container. Sensitive keys omit values; use
   * {@link isFluxSensitiveEnvKey} for the rule set.
   */
  async listProjectEnv(slug: string): Promise<FluxProjectEnvEntry[]> {
    const normalized = slugifyProjectName(slug);
    const inspect = await this.getPostgrestInspectOrThrow(normalized);
    const record = envRecordFromDockerEnv(inspect.Config.Env);
    const rows: FluxProjectEnvEntry[] = [];
    for (const key of Object.keys(record).sort((a, b) => a.localeCompare(b))) {
      if (isFluxSensitiveEnvKey(key)) {
        rows.push({ key, sensitive: true });
      } else {
        rows.push({ key, value: record[key] ?? "", sensitive: false });
      }
    }
    return rows;
  }

  /**
   * Replaces `PGRST_JWT_SECRET` on the PostgREST container by recreating it with the same image,
   * labels, and host config. Restarts the container if it was running so the new secret applies.
   */
  async updatePostgrestJwtSecret(
    projectName: string,
    newJwtSecret: string,
  ): Promise<void> {
    const secret = newJwtSecret.trim();
    if (!secret) {
      throw new Error("JWT secret cannot be empty.");
    }
    const slug = slugifyProjectName(projectName);
    await this.setProjectEnv(slug, { PGRST_JWT_SECRET: secret });
  }

  private async getPostgrestInspectOrThrow(
    slug: string,
  ): Promise<Awaited<ReturnType<Docker.Container["inspect"]>>> {
    const apiName = postgrestContainerName(slug);
    try {
      return await this.docker.getContainer(apiName).inspect();
    } catch (err: unknown) {
      if (getHttpStatus(err) === 404) {
        throw new Error(
          `PostgREST container "${apiName}" not found for this project.`,
        );
      }
      throw err;
    }
  }

  /**
   * Stops/removes the API container and creates a new one with `mergedEnv`, preserving Traefik
   * labels and host settings from `inspect` unless `replaceOptions.labels` is set.
   */
  private async replacePostgrestApiContainer(
    slug: string,
    inspect: Awaited<ReturnType<Docker.Container["inspect"]>>,
    mergedEnv: Record<string, string>,
    replaceOptions?: { labels?: Record<string, string> },
  ): Promise<void> {
    const apiName = postgrestContainerName(slug);
    const container = this.docker.getContainer(inspect.Id);
    const env = dockerEnvFromRecord(mergedEnv);
    const wasRunning = inspect.State.Running;

    if (wasRunning) {
      try {
        await container.stop({ t: 10 });
      } catch (err: unknown) {
        const code = getHttpStatus(err);
        if (code !== 304 && code !== 404) throw err;
      }
    }

    try {
      await container.remove();
    } catch (err: unknown) {
      if (getHttpStatus(err) !== 404) throw err;
    }

    const hc = inspect.HostConfig;
    const networkMode =
      hc.NetworkMode &&
      hc.NetworkMode !== "" &&
      hc.NetworkMode !== "default"
        ? hc.NetworkMode
        : FLUX_NETWORK_NAME;
    const memory =
      typeof hc.Memory === "number" && hc.Memory > 0
        ? hc.Memory
        : 256 * 1024 * 1024;
    const restartPolicy = hc.RestartPolicy ?? {
      Name: "on-failure" as const,
      MaximumRetryCount: 25,
    };

    const created = await this.docker.createContainer({
      name: apiName,
      Image: inspect.Config.Image,
      Labels: replaceOptions?.labels ?? inspect.Config.Labels ?? {},
      Env: env,
      ExposedPorts: inspect.Config.ExposedPorts ?? { "3000/tcp": {} },
      HostConfig: {
        NetworkMode: networkMode,
        Memory: memory,
        RestartPolicy: restartPolicy,
      },
    });

    if (wasRunning) {
      await created.start();
      const newInspect = await created.inspect();
      await this.ensureContainerAttachedToFluxNetwork(newInspect.Id);
    }
  }

  /**
   * Host-side Postgres URI (`127.0.0.1:{publishedPort}`) for the project.
   * Requires the Postgres container to be running (same as {@link executeSql}).
   */
  async getPostgresHostConnectionString(projectName: string): Promise<string> {
    const { hostPort, password } =
      await this.resolveRunningPostgresCredentials(projectName);
    return postgresHostConnectionUri(hostPort, password);
  }

  /**
   * Reads `PGRST_JWT_SECRET` from the running PostgREST container’s `inspect().Config.Env` and signs
   * anon / service_role JWTs with that same material — never invents a new secret.
   */
  async getProjectKeys(
    slug: string,
  ): Promise<{ anonKey: string; serviceRoleKey: string }> {
    const apiName = postgrestContainerName(slug);
    let inspect: Awaited<ReturnType<Docker.Container["inspect"]>>;
    try {
      inspect = await this.docker.getContainer(apiName).inspect();
    } catch (err: unknown) {
      if (getHttpStatus(err) === 404) {
        throw new Error(
          `No PostgREST container found for slug "${slug}" (expected "${apiName}").`,
        );
      }
      throw err;
    }

    const secret = readPgrstJwtSecretFromContainerEnv(inspect, apiName);

    const anonKey = jwt.sign({ role: "anon" }, secret);
    const serviceRoleKey = jwt.sign({ role: "service_role" }, secret);
    return { anonKey, serviceRoleKey };
  }

  /**
   * Runs arbitrary SQL against an existing Flux project's Postgres instance.
   *
   * Retrieves connection details (host port, password) from the running container's
   * inspect data so callers don't need to store credentials out of band.
   * After migrations, asks PostgREST to reload its schema cache: `NOTIFY pgrst, 'reload schema'`
   * (handled by PostgREST’s DB listener), a short pause, then **SIGUSR1** on the API container.
   * PostgREST documents SIGUSR1 for schema reload; SIGHUP does not reload the schema cache.
   */
  async executeSql(projectName: string, sql: string): Promise<void> {
    const { slug, hostPort, password } =
      await this.resolveRunningPostgresCredentials(projectName);
    await runSql(hostPort, password, sql);
    await runSql(hostPort, password, `NOTIFY pgrst, 'reload schema';`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const apiName = postgrestContainerName(slug);
    try {
      await this.docker.getContainer(apiName).kill({ signal: "SIGUSR1" });
    } catch (err: unknown) {
      const code = getHttpStatus(err);
      if (code === 404 || code === 409) return;
      throw err;
    }
  }

  /**
   * Applies a plain SQL dump file to the tenant Postgres using **`psql -f`** (not Docker API stdin
   * attach, which can hang): host `psql` to `127.0.0.1:{port}` when available, otherwise
   * **`docker cp`** the file into the DB container and **`docker exec psql -f`**.
   *
   * By default, strips session `SET` lines that the tenant Postgres version does not support (see
   * {@link preparePlainSqlDumpForFlux}). Use {@link ImportSqlFileOptions} for Supabase-style dumps.
   *
   * After the dump applies, always re-runs {@link API_SCHEMA_PRIVILEGES_SQL} so `anon` /
   * `authenticated` keep `USAGE`/`SELECT`/DML on all tables in `api` (including objects from the
   * dump). Optional {@link ImportSqlFileOptions.disableRowLevelSecurityInApi} turns off RLS on
   * imported tables that still have it enabled (common when porting from Supabase).
   *
   * Returns counts of objects moved when {@link ImportSqlFileOptions.moveFromPublic} is true.
   */
  async importSqlFile(
    slug: string,
    filePath: string,
    options?: ImportSqlFileOptions,
  ): Promise<ImportSqlFileResult> {
    const emptyResult: ImportSqlFileResult = {
      tablesMoved: 0,
      sequencesMoved: 0,
      viewsMoved: 0,
    };

    const { slug: normalizedSlug, hostPort, password } =
      await this.resolveRunningPostgresCredentials(slug);

    const materialized = await materializePreparedSqlFile(
      filePath,
      options,
      () => queryPostgresMajorVersion(hostPort, password),
    );

    try {
      await runTenantPsqlFile({
        hostPort,
        password,
        sqlPath: materialized.path,
        pgUser: POSTGRES_USER,
        containerName: postgresContainerName(normalizedSlug),
      });

      let moveResult = emptyResult;
      if (options?.moveFromPublic === true) {
        moveResult = await runMovePublicToApiWithClient(
          hostPort,
          password,
          POSTGRES_USER,
        );
      }

      await runSql(hostPort, password, API_SCHEMA_PRIVILEGES_SQL);
      if (options?.disableRowLevelSecurityInApi === true) {
        await runSql(
          hostPort,
          password,
          DISABLE_ROW_LEVEL_SECURITY_FOR_RLS_ENABLED_API_TABLES_SQL,
        );
      }

      await runSql(hostPort, password, `NOTIFY pgrst, 'reload schema';`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const apiName = postgrestContainerName(normalizedSlug);
      try {
        await this.docker.getContainer(apiName).kill({ signal: "SIGUSR1" });
      } catch (err: unknown) {
        const code = getHttpStatus(err);
        if (code === 404 || code === 409) return moveResult;
        throw err;
      }

      return moveResult;
    } finally {
      await materialized.cleanup();
    }
  }

  /**
   * Drops `public` and `auth` (if present) and reapplies {@link BOOTSTRAP_SQL} so the next
   * {@link importSqlFile} runs against a clean slate. Does not remove the Docker volume (use
   * {@link nukeProject} for that).
   */
  async resetTenantDatabaseForImport(projectName: string): Promise<void> {
    const { hostPort, password } =
      await this.resolveRunningPostgresCredentials(projectName);
    const resetSql = `
DROP SCHEMA IF EXISTS auth CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
ALTER SCHEMA public OWNER TO postgres;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
COMMENT ON SCHEMA public IS 'standard public schema';
`.trim();
    await runSql(hostPort, password, resetSql);
    await runSql(hostPort, password, BOOTSTRAP_SQL);
  }

  private async resolveRunningPostgresCredentials(projectName: string): Promise<{
    slug: string;
    hostPort: number;
    password: string;
  }> {
    const slug = slugifyProjectName(projectName);
    const containerName = postgresContainerName(slug);

    const containers = await this.docker.listContainers({
      all: true,
      filters: { name: [containerName] },
    });
    const match = containers.find((c) =>
      c.Names?.some((n) => n === `/${containerName}` || n === containerName),
    );
    if (!match) {
      throw new Error(
        `No Postgres container found for project "${projectName}" (expected "${containerName}").`,
      );
    }
    if (match.State !== "running") {
      throw new Error(
        `Postgres container "${containerName}" exists but is not running (state: ${match.State}).`,
      );
    }

    const inspect = await this.docker.getContainer(match.Id).inspect();
    const hostPort = hostPortForTcp(inspect, "5432/tcp");

    const password = inspect.Config.Env?.find((e) =>
      e.startsWith("POSTGRES_PASSWORD="),
    )?.slice("POSTGRES_PASSWORD=".length);
    if (!password) {
      throw new Error(
        `Could not retrieve POSTGRES_PASSWORD from container "${containerName}".`,
      );
    }

    return { slug, hostPort, password };
  }

  /**
   * Lists Flux tenant projects by scanning Docker for `flux-*-db` / `flux-*-api` containers.
   */
  async listProjects(): Promise<FluxProjectSummary[]> {
    const containers = await this.docker.listContainers({ all: true });
    const bySlug = new Map<
      string,
      { dbState?: string; apiState?: string }
    >();

    for (const c of containers) {
      const raw = c.Names?.[0]?.replace(/^\//, "") ?? "";
      const m = raw.match(FLUX_TENANT_CONTAINER);
      if (!m?.[1] || !m[2]) continue;
      const slug = m[1];
      const kind = m[2] as "db" | "api";
      const cur = bySlug.get(slug) ?? {};
      if (kind === "db") cur.dbState = c.State;
      else cur.apiState = c.State;
      bySlug.set(slug, cur);
    }

    const rows: FluxProjectSummary[] = [];
    for (const [slug, e] of bySlug) {
      const hasDb = e.dbState !== undefined;
      const hasApi = e.apiState !== undefined;
      const dr = e.dbState === "running";
      const ar = e.apiState === "running";

      let status: FluxProjectSummary["status"];
      if (hasDb && hasApi) {
        if (dr && ar) status = "running";
        else if (!dr && !ar) status = "stopped";
        else status = "partial";
      } else {
        status = "partial";
      }

      rows.push({
        slug,
        status,
        apiUrl: fluxApiUrlForSlug(slug),
      });
    }

    return rows.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /**
   * Stub for a future “reaper” that auto-pauses idle free-tier tenant stacks.
   * Loads every row from the flux-system `projects` table with `last_active_at` and flags rows
   * older than `maxAgeDays`. Does not stop containers yet.
   */
  async stopInactiveProjects(
    maxAgeDays: number,
  ): Promise<FluxSystemProjectActivity[]> {
    const uri = await this.getPostgresHostConnectionString("flux-system");
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - maxAgeMs;

    const client = new pg.Client({
      connectionString: uri,
      connectionTimeoutMillis: 3000,
    });
    await client.connect();
    try {
      const res = await client.query<{
        id: string;
        name: string;
        slug: string;
        last_active_at: Date;
      }>(
        `SELECT id::text AS id, name, slug, last_active_at
         FROM projects
         ORDER BY slug`,
      );
      return res.rows.map((row) => {
        const lastActiveAt = new Date(row.last_active_at);
        return {
          id: row.id,
          name: row.name,
          slug: row.slug,
          lastActiveAt,
          inactiveByPolicy: lastActiveAt.getTime() < cutoff,
        };
      });
    } finally {
      await client.end();
    }
  }

  /**
   * Stops the Postgres and PostgREST containers for a project (API first, then DB).
   */
  async stopProject(name: string): Promise<void> {
    const slug = slugifyProjectName(name);
    const apiName = postgrestContainerName(slug);
    const dbName = postgresContainerName(slug);
    await this.stopContainerOrThrow(apiName);
    await this.stopContainerOrThrow(dbName);
  }

  /**
   * Starts the Postgres and PostgREST containers (DB first, then API).
   */
  async startProject(name: string): Promise<void> {
    const slug = slugifyProjectName(name);
    const dbName = postgresContainerName(slug);
    const apiName = postgrestContainerName(slug);
    await this.startContainerOrThrow(dbName);
    await this.startContainerOrThrow(apiName);
  }

  /**
   * Stops and removes both tenant containers and deletes the Postgres data volume.
   * Irreversible: all database files for the project are destroyed.
   */
  async nukeProject(
    name: string,
    options: NukeProjectOptions,
  ): Promise<void> {
    const slug = slugifyProjectName(name);
    const vol = tenantVolumeName(slug);
    const apiName = postgrestContainerName(slug);
    const dbName = postgresContainerName(slug);

    for (const containerName of [apiName, dbName]) {
      try {
        await this.docker.getContainer(containerName).remove({ force: true });
      } catch (err: unknown) {
        if (getHttpStatus(err) !== 404) throw err;
      }
    }

    try {
      await this.docker.getVolume(vol).remove({ force: true });
    } catch (err: unknown) {
      if (getHttpStatus(err) !== 404) throw err;
    }
  }

  private async stopContainerOrThrow(containerName: string): Promise<void> {
    try {
      await this.docker.getContainer(containerName).stop();
    } catch (err: unknown) {
      const code = getHttpStatus(err);
      if (code === 404) {
        throw new Error(`Container "${containerName}" does not exist.`);
      }
      if (code === 304) return;
      throw err;
    }
  }

  private async startContainerOrThrow(containerName: string): Promise<void> {
    try {
      await this.docker.getContainer(containerName).start();
    } catch (err: unknown) {
      const code = getHttpStatus(err);
      if (code === 404) {
        throw new Error(`Container "${containerName}" does not exist.`);
      }
      if (code === 304) return;
      throw err;
    }
  }

  /**
   * Ensures the Docker bridge {@link FLUX_NETWORK_NAME} exists (create if missing).
   */
  private async ensureFluxNetwork(
    onStatus?: (message: string) => void,
  ): Promise<void> {
    onStatus?.(`Checking Docker network ${FLUX_NETWORK_NAME}…`);
    const networks = await this.docker.listNetworks({
      filters: { name: [FLUX_NETWORK_NAME] },
    });
    if (!networks.some((n) => n.Name === FLUX_NETWORK_NAME)) {
      await this.docker.createNetwork({
        Name: FLUX_NETWORK_NAME,
        Driver: "bridge",
        CheckDuplicate: true,
      });
      onStatus?.(`Created network ${FLUX_NETWORK_NAME}.`);
    } else {
      onStatus?.(`Network ${FLUX_NETWORK_NAME} already exists.`);
    }
  }

  /**
   * Ensures {@link FLUX_GATEWAY_CONTAINER_NAME} runs Traefik with the Docker provider, socket
   * access (read-only), `web` on host port 80, and attachment to {@link FLUX_NETWORK_NAME}.
   *
   * Uses {@link FLUX_DOCKER_IMAGES.traefik} **v3.6+** so the Docker client negotiates API version with
   * the Engine (older Traefik builds pinned API 1.24 and fail on recent Docker). The gateway also sets
   * `DOCKER_API_VERSION=1.41` and `--providers.docker.httpClientTimeout=300s` for the socket client.
   *
   * Idempotent: **start** if stopped, **create** if missing, **attach** to `flux-network` if needed.
   * Invoked on every {@link ProjectManager.provisionProject} so a stopped gateway is revived even
   * when the bridge network already existed.
   */
  private async ensureFluxGateway(
    onStatus?: (message: string) => void,
  ): Promise<void> {
    const name = FLUX_GATEWAY_CONTAINER_NAME;
    onStatus?.(`Ensuring Traefik gateway ${name}…`);

    try {
      const existing = this.docker.getContainer(name);
      const inspect = await existing.inspect();
      if (!inspect.State.Running) {
        onStatus?.(`Starting existing gateway container ${name}…`);
        await existing.start();
      } else {
        onStatus?.(`Gateway ${name} is already running.`);
      }
      await this.ensureContainerAttachedToFluxNetwork(inspect.Id);
      return;
    } catch (err: unknown) {
      if (getHttpStatus(err) !== 404) throw err;
    }

    onStatus?.(`Creating gateway ${name} (image ${TRAEFIK_IMAGE})…`);
    await ensureImage(this.docker, TRAEFIK_IMAGE, onStatus);

    try {
      const gateway = await this.docker.createContainer({
        name,
        Image: TRAEFIK_IMAGE,
        Env: ["DOCKER_API_VERSION=1.41"],
        Cmd: [
          "--providers.docker=true",
          "--providers.docker.exposedbydefault=false",
          `--providers.docker.network=${FLUX_NETWORK_NAME}`,
          "--providers.docker.httpClientTimeout=300s",
          "--entrypoints.web.address=:80",
        ],
        ExposedPorts: { "80/tcp": {} },
        HostConfig: {
          Binds: ["/var/run/docker.sock:/var/run/docker.sock:ro"],
          PortBindings: {
            "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "80" }],
          },
          NetworkMode: FLUX_NETWORK_NAME,
          Memory: 256 * 1024 * 1024,
          RestartPolicy: { Name: "unless-stopped" },
        },
      });
      await gateway.start();
    } catch (err: unknown) {
      if (getHttpStatus(err) === 409) {
        const existing = this.docker.getContainer(name);
        const inspect = await existing.inspect();
        if (!inspect.State.Running) {
          onStatus?.(`Gateway ${name} already exists but was stopped; starting…`);
          await existing.start();
        }
        await this.ensureContainerAttachedToFluxNetwork(inspect.Id);
        return;
      }
      throw err;
    }
  }

  private async ensureContainerAttachedToFluxNetwork(
    containerId: string,
  ): Promise<void> {
    const inspect = await this.docker.getContainer(containerId).inspect();
    const nets = inspect.NetworkSettings.Networks ?? {};
    if (nets[FLUX_NETWORK_NAME]) return;
    try {
      await this.docker.getNetwork(FLUX_NETWORK_NAME).connect({
        Container: containerId,
      });
    } catch (err: unknown) {
      if (getHttpStatus(err) === 409) return;
      throw err;
    }
  }
}

export async function testDockerConnection(): Promise<void> {
  const docker = new Docker();

  console.log("🔄 Attempting to connect to Docker socket...");

  try {
    const ping = await docker.ping();
    console.log("✅ Docker Connection: SUCCESS");
    console.log(`📡 Ping Response: ${ping.toString()}`);

    // Added { all: true } so we can see the hello-world container
    const containers = await docker.listContainers({ all: true });

    console.log(`📦 Found ${containers.length} total containers:`);

    if (containers.length === 0) {
      console.log(
        "ℹ️  No containers found. Try running 'docker run hello-world' in another terminal.",
      );
    }

    for (const c of containers) {
      const name = c.Names?.[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12);
      const status = c.State; // running, exited, etc.
      console.log(`   - [${status.toUpperCase()}] ${name} (Image: ${c.Image})`);
    }
  } catch (err) {
    console.error("❌ Docker Connection: FAILED");
    console.error(err);
    process.exit(1);
  }
}

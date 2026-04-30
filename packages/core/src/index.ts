import { existsSync, readFileSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import { freemem, homedir, loadavg, totalmem } from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import Docker from "dockerode";
import jwt from "jsonwebtoken";

import { FLUX_AUTH_SCHEMA_AND_UID_SQL } from "./auth-compat-sql.ts";
import {
  API_SCHEMA_PRIVILEGES_SQL,
  DISABLE_ROW_LEVEL_SECURITY_FOR_RLS_ENABLED_API_TABLES_SQL,
} from "./api-schema-privileges.ts";
import {
  materializePreparedSqlFile,
  queryPostgresMajorVersion,
  type ImportSqlFileOptions,
} from "./import-dump.ts";
import {
  queryPsqlJsonRows,
  runPsqlHostFileInsideContainer,
  runPsqlSqlInsideContainer,
  waitPostgresReadyInsideContainer,
} from "./postgres-internal-exec.ts";
import {
  demuxDockerLogBufferIfMultiplexed,
  demuxDockerLogStream,
} from "./docker-log-stream.ts";
import { runMovePublicToApiWithDockerExec } from "./schema-move-public-to-api.ts";
import {
  FLUX_PROJECT_HASH_HEX_LEN,
  FLUX_SYSTEM_HASH,
  generateProjectHash,
} from "./tenant-suffix.ts";
import {
  type FluxProjectEnvEntry,
  type FluxProjectSummary,
  type ImportSqlFileResult,
  fluxTenantStatusFromContainerPair,
  slugifyProjectName,
} from "./standalone.ts";
import {
  fluxApiHttpsForTenantUrls,
  fluxApiUrlForSlug,
  fluxTenantDomain,
  fluxTenantPostgrestHostname,
} from "./tenant-catalog-urls.ts";

export {
  FLUX_DEFAULT_DOMAIN,
  fluxTenantDomain,
  fluxApiHttpsForTenantUrls,
  fluxTenantPostgrestHostname,
  fluxApiUrlForSlug,
  type FluxCatalogProjectMode,
  fluxTenantV2SharedHostname,
  fluxApiUrlForV2Shared,
  fluxApiUrlForCatalog,
} from "./tenant-catalog-urls.ts";

export type { ImportSqlFileOptions } from "./import-dump.ts";
export type { MovePublicToApiResult } from "./schema-move-public-to-api.ts";

export type { ImportSqlFileResult, FluxProjectEnvEntry, FluxProjectSummary } from "./standalone.ts";
export { slugifyProjectName, fluxTenantStatusFromContainerPair } from "./standalone.ts";
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
export { FLUX_AUTH_SCHEMA_AND_UID_SQL } from "./auth-compat-sql.ts";
export {
  FLUX_PROJECT_HASH_HEX_LEN,
  FLUX_SYSTEM_HASH,
  generateProjectHash,
} from "./tenant-suffix.ts";

/**
 * Engine + host snapshot for control-plane dashboards (`ProjectManager.getNodeStats`).
 * `memoryUsage` / `cpuLoad` reflect the Node `os` module (same process view as the control plane).
 */
export type FluxNodeStats = {
  /** Total local containers on the Engine (from `docker info`). */
  containerCount: number;
  /** RAM use approx. % of host (0–100, one decimal) from `os` freemem/totalmem. */
  memoryUsage: number;
  /** 1-minute load average (Unix); `0` if unavailable. */
  cpuLoad: number;
};

export type ProjectDumpOptions = {
  schemaOnly?: boolean;
  dataOnly?: boolean;
  clean?: boolean;
  publicOnly?: boolean;
};

export const FLUX_NETWORK_NAME = "flux-network";

/**
 * Docker labels: Flux-managed Postgres / PostgREST (filter from Traefik, dashboard, etc.).
 * Third-party namespaced keys from a historical engine are stripped on label reconcile; new
 * containers use the `flux.*` namespace.
 */
export const FLUX_MANAGED_LABEL = "flux.managed" as const;
export const FLUX_MANAGED_VALUE = "true" as const;
export const FLUX_PURPOSE_LABEL = "flux.purpose" as const;
export const FLUX_PROJECT_SLUG_LABEL = "flux.project.slug" as const;
export const FLUX_PURPOSE_TENANT = "tenant" as const;
export const FLUX_PURPOSE_CONTROL_PLANE = "control-plane" as const;

/** String literals for historical engine labels; must match what appears on live containers. */
const LEGACY_UMBRELLA_DOCKER_LABEL_KEYS: ReadonlySet<string> = new Set([
  "vessel.managed",
  "vessel.purpose",
  "vessel.project.slug",
  "vessel.flux.managed",
]);

const FLUX_TENANT_DEFAULT_MEMORY_BYTES = 256 * 1024 * 1024;
/** 0.5 vCPU for each of DB and API (tunable; stack uses ~1 core under full load on both). */
const FLUX_TENANT_DEFAULT_NANOCPUS = 500_000_000;

/**
 * Per-tenant memory reservation (cgroup soft hint) and default cap (bytes), default 256 MiB.
 * Override with `FLUX_TENANT_MEMORY_BYTES` (decimal integer). Used for both `MemoryReservation`
 * and `Memory` on tenant containers unless the container already has stricter inspect values.
 */
export function fluxTenantMemoryLimitBytes(): number {
  const raw = process.env.FLUX_TENANT_MEMORY_BYTES?.trim();
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return FLUX_TENANT_DEFAULT_MEMORY_BYTES;
}

/**
 * Per-container CPU cap in nanoseconds per CPU per second, default 0.5 vCPU. Override with
 * `FLUX_TENANT_CPU` as a positive decimal (e.g. `0.5`); converted with `round(cpu * 1e9)`.
 */
export function fluxTenantCpuNanoCpus(): number {
  const raw = process.env.FLUX_TENANT_CPU?.trim();
  if (raw) {
    const f = Number.parseFloat(raw);
    if (Number.isFinite(f) && f > 0) {
      return Math.max(1, Math.round(f * 1_000_000_000));
    }
  }
  return FLUX_TENANT_DEFAULT_NANOCPUS;
}

/** Production default: Docker only accepts `MaximumRetryCount` with `on-failure`; use plain `unless-stopped` for tenant stacks. */
const FLUX_TENANT_RESTART_POLICY = {
  Name: "unless-stopped" as const,
};

function tenantStackHostMemoryConfig(): {
  Memory: number;
  MemoryReservation: number;
} {
  const b = fluxTenantMemoryLimitBytes();
  return { Memory: b, MemoryReservation: b };
}

/**
 * Traefik gateway container (Docker provider: `web` on :80; optional `websecure` on :443 with ACME).
 * Set `FLUX_TRAEFIK_CERTRESOLVER` (or `FLUX_DOMAIN` / remote `DOCKER_HOST`) on the control plane
 * to match this Traefik’s ACME resolver; tenant PostgREST routers use `websecure` + that resolver.
 */
export const FLUX_GATEWAY_CONTAINER_NAME = "flux-gateway";

/** Pinned images for Flux project stacks (Postgres + PostgREST + Traefik). */
export const FLUX_DOCKER_IMAGES = {
  postgres: "postgres:16.2-alpine",
  postgrest: "postgrest/postgrest:v12.0.2",
  traefik: "traefik:v3.6.7",
} as const;

const POSTGRES_IMAGE = FLUX_DOCKER_IMAGES.postgres;
const POSTGREST_IMAGE = FLUX_DOCKER_IMAGES.postgrest;

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
 * Installs Supabase-compatible **`auth`** schema and **`auth.uid()`** (returns **text**, JWT `sub`
 * from `request.jwt.claims`) for RLS with Clerk / NextAuth string IDs.
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

${FLUX_AUTH_SCHEMA_AND_UID_SQL}

${API_SCHEMA_PRIVILEGES_SQL}
`.trim();

function randomHexChars(byteLength: number): string {
  return randomBytes(byteLength).toString("hex");
}

/**
 * When `FLUX_RESET_TENANT_VOLUME` is truthy (`1`, `true`, `yes`), {@link ProjectManager.provisionProject}
 * removes the tenant PostgREST + Postgres containers and the named volume before recreating Postgres
 * (fresh `PGDATA` with the password used in `PGRST_DB_URI`).
 */
function fluxResetTenantVolumeEnabled(): boolean {
  const v = process.env.FLUX_RESET_TENANT_VOLUME?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Dev/test only: non-empty `FLUX_DEV_POSTGRES_PASSWORD` derives a stable Postgres password from the
 * tenant volume name so `POSTGRES_PASSWORD` and `PGRST_DB_URI` never drift. **Do not use in production.**
 */
function fluxDevPostgresPasswordSecret(): string | undefined {
  const s = process.env.FLUX_DEV_POSTGRES_PASSWORD?.trim();
  return s && s.length > 0 ? s : undefined;
}

function deterministicPostgresPasswordFromDevSecret(
  secret: string,
  volumeName: string,
): string {
  return createHmac("sha256", secret)
    .update(volumeName, "utf8")
    .digest("hex")
    .slice(0, 32);
}

/**
 * Deterministic HMAC-SHA256 PostgreSQL superuser password for a tenant, matching
 * `FLUX_DEV_POSTGRES_PASSWORD` / `FLUX_PROJECT_PASSWORD_SECRET` at provision time (same bytes as
 * `deterministicPostgresPasswordFromDevSecret` for {@link tenantVolumeName} of this `(hash, slug)`).
 */
export function deriveTenantPostgresPasswordFromSecret(
  secret: string,
  hash: string,
  slugOrName: string,
): string {
  const slug = slugifyProjectName(slugOrName);
  return deterministicPostgresPasswordFromDevSecret(
    secret.trim(),
    tenantVolumeName(hash, slug),
  );
}

/**
 * Removes API + DB containers, the data volume, and the per-tenant private network when
 * `privateNetworkName` is set (404-safe). `onPurge` is called **before** each remove (resource name).
 */
async function removeApiPgAndVolumeForProvision(
  docker: Docker,
  apiContainerName: string,
  pgContainerName: string,
  volumeName: string,
  privateNetworkName?: string,
  onPurge?: (resourceName: string) => void,
): Promise<void> {
  for (const name of [apiContainerName, pgContainerName]) {
    onPurge?.(name);
    try {
      await docker.getContainer(name).remove({ force: true });
    } catch (err: unknown) {
      if (getHttpStatus(err) !== 404) throw err;
    }
  }
  onPurge?.(volumeName);
  try {
    await docker.getVolume(volumeName).remove({ force: true });
  } catch (err: unknown) {
    if (getHttpStatus(err) !== 404) throw err;
  }
  if (privateNetworkName && privateNetworkName.length > 0) {
    onPurge?.(privateNetworkName);
    await removeDockerNetworkByNameAllowMissing(docker, privateNetworkName);
  }
}

/**
 * Disconnects all endpoints (survives stale attachments) then removes the network.
 * 404 if the network does not exist is treated as success.
 */
async function removeDockerNetworkByNameAllowMissing(
  docker: Docker,
  networkName: string,
): Promise<void> {
  let inspect: { Containers?: Record<string, unknown> };
  try {
    inspect = (await docker.getNetwork(networkName).inspect()) as {
      Containers?: Record<string, unknown>;
    };
  } catch (err: unknown) {
    if (getHttpStatus(err) === 404) return;
    throw err;
  }
  const net = docker.getNetwork(networkName);
  for (const containerId of Object.keys(inspect.Containers ?? {})) {
    try {
      await net.disconnect({ Container: containerId, Force: true });
    } catch (err: unknown) {
      if (getHttpStatus(err) !== 404) throw err;
    }
  }
  try {
    await net.remove();
  } catch (err: unknown) {
    if (getHttpStatus(err) === 404) return;
    throw err;
  }
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

async function startFluxContainerIfStopped(
  container: Docker.Container,
): Promise<void> {
  const i = await container.inspect();
  if (!i.State.Running) {
    await container.start();
  }
}

/** `inspect()` for a named container, or `null` if it does not exist (404). */
async function fluxInspectContainerOrNull(
  docker: Docker,
  name: string,
): Promise<Awaited<ReturnType<Docker.Container["inspect"]>> | null> {
  try {
    return await docker.getContainer(name).inspect();
  } catch (err: unknown) {
    if (getHttpStatus(err) === 404) return null;
    throw err;
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

/** Ensures `PGRST_DB_URI` matches the current Postgres Docker DNS name (e.g. after tenant-hash renames). */
function mergePostgrestEnvWithDbUri(
  existing: Record<string, string>,
  dbUri: string,
): Record<string, string> {
  return { ...existing, PGRST_DB_URI: dbUri };
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

/** `flux-{hash}-{slug}` — base for `-db`, `-api`, Traefik router id, etc. */
function fluxTenantStackBaseId(hash: string, slug: string): string {
  return `flux-${hash}-${slug}`;
}

/** Per-tenant isolated internal bridge for DB + API (Postgres only on this network; API also on {@link FLUX_NETWORK_NAME}). */
function projectPrivateNetworkName(hash: string, slug: string): string {
  return `${fluxTenantStackBaseId(hash, slug)}-net`;
}

/**
 * The `flux-system` project hosts the control-plane DB; services on {@link FLUX_NETWORK_NAME} (e.g. the
 * dashboard) must be able to reach it via Docker DNS, while other tenants' Postgres must stay
 * off the shared bridge. See {@link ProjectManager} provision / align.
 */
function isPlatformSystemStackSlug(slug: string): boolean {
  return slug === "flux-system";
}

/**
 * Loopback bind for optional `flux-system` host port maps so Postgres / PostgREST are not exposed on
 * all interfaces.
 */
const FLUX_SYSTEM_HOST_PORT_BIND = "127.0.0.1";

/**
 * Parses `FLUX_SYSTEM_POSTGRES_PUBLISH_PORT` / `FLUX_SYSTEM_POSTGREST_PUBLISH_PORT` when set.
 * Must be a decimal TCP port 1–65535.
 */
function parseFluxSystemHostPublishPortEnv(envName: string): string | undefined {
  const raw = process.env[envName]?.trim();
  if (!raw) return undefined;
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(
      `${envName} must be empty or a decimal TCP port number (1–65535).`,
    );
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(
      `${envName} must be empty or a decimal TCP port number (1–65535).`,
    );
  }
  return String(n);
}

/** Host port for `flux-system` Postgres (`127.0.0.1:<port>` → container `5432/tcp`), or unset. */
function fluxSystemPostgresHostPublishPort(slug: string): string | undefined {
  if (!isPlatformSystemStackSlug(slug)) return undefined;
  return parseFluxSystemHostPublishPortEnv("FLUX_SYSTEM_POSTGRES_PUBLISH_PORT");
}

/** Host port for `flux-system` PostgREST (`127.0.0.1:<port>` → container `3000/tcp`), or unset. */
function fluxSystemPostgrestHostPublishPort(slug: string): string | undefined {
  if (!isPlatformSystemStackSlug(slug)) return undefined;
  return parseFluxSystemHostPublishPortEnv("FLUX_SYSTEM_POSTGREST_PUBLISH_PORT");
}

/** Purpose + slug metadata for Flux-managed DB/API containers (see {@link FLUX_MANAGED_LABEL}). */
function fluxContainerMetadataLabels(slug: string): Record<string, string> {
  const out: Record<string, string> = {
    [FLUX_MANAGED_LABEL]: FLUX_MANAGED_VALUE,
  };
  if (isPlatformSystemStackSlug(slug)) {
    out[FLUX_PURPOSE_LABEL] = FLUX_PURPOSE_CONTROL_PLANE;
  } else {
    out[FLUX_PURPOSE_LABEL] = FLUX_PURPOSE_TENANT;
    out[FLUX_PROJECT_SLUG_LABEL] = slug;
  }
  return out;
}

function stripLegacyUmbrellaMetadataFromLabels(
  labels: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels)) {
    if (LEGACY_UMBRELLA_DOCKER_LABEL_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

function postgresContainerName(hash: string, slug: string): string {
  return `${fluxTenantStackBaseId(hash, slug)}-db`;
}

function postgrestContainerName(hash: string, slug: string): string {
  return `${fluxTenantStackBaseId(hash, slug)}-api`;
}

/** `flux-{hash}-{slug}-db-data` — Docker named volume for tenant PG data (used in deterministic password derivation). */
export function tenantVolumeName(hash: string, slug: string): string {
  return `${fluxTenantStackBaseId(hash, slug)}-db-data`;
}

/**
 * Default Traefik ACME `certificatesresolvers.<name>`; must match the edge gateway compose
 * (e.g. `docker/traefik/docker-compose.yml` uses `myresolver`). Overridden by `FLUX_TRAEFIK_CERTRESOLVER`, or
 * set implicitly when `FLUX_DOMAIN` enables HTTPS edge routing.
 */
export const FLUX_TRAEFIK_ACME_RESOLVER = "myresolver" as const;

/**
 * `true` if `DOCKER_HOST` targets a non-default Engine (SSH, remote `tcp`/`https`). Enables edge
 * PostgREST labels on the **remote** host. `FLUX_TRAEFIK_NO_EDGE=1` keeps `web`-only over SSH.
 */
function fluxControlPlaneTargetIsRemoteEngine(): boolean {
  const o = process.env.FLUX_TRAEFIK_NO_EDGE?.trim().toLowerCase();
  if (o === "1" || o === "true" || o === "yes") {
    return false;
  }
  const dh = (process.env.DOCKER_HOST ?? "").trim();
  if (dh.length === 0) {
    return false;
  }
  const l = dh.toLowerCase();
  if (l.startsWith("unix://") || l === "unix:") {
    return false;
  }
  if (l.startsWith("npipe://") || dh.includes("\\\\.\\pipe\\")) {
    return false;
  }
  if (l.startsWith("ssh://")) {
    return true;
  }
  if (l.startsWith("http://") || l.startsWith("https://")) {
    return true;
  }
  if (l.startsWith("tcp://")) {
    if (
      /\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])[:/]/i.test(dh) ||
      /:\/\/localhost[:\/]/i.test(dh)
    ) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * When **non-`null`**, PostgREST gets Traefik labels for `websecure` + myresolver. **Non-`null`** for
 * `FLUX_TRAEFIK_CERTRESOLVER`, `FLUX_DOMAIN`, or remote `DOCKER_HOST` (typical: `ssh://` from the
 * `flux` CLI on a dev machine). **Null** for local `docker` (no `DOCKER_HOST` / `unix` socket). Use
 * `FLUX_TRAEFIK_NO_EDGE=1` to turn off over SSH. Labels use {@link FLUX_TRAEFIK_ACME_RESOLVER}.
 */
export function fluxTraefikCertResolverName(): string | null {
  const r = process.env.FLUX_TRAEFIK_CERTRESOLVER?.trim();
  if (r) return r;
  if (fluxApiHttpsForTenantUrls()) return FLUX_TRAEFIK_ACME_RESOLVER;
  if (fluxControlPlaneTargetIsRemoteEngine()) return FLUX_TRAEFIK_ACME_RESOLVER;
  return null;
}

/**
 * Traefik v3 `Host()` matcher: backticks wrap the literal hostname (required syntax).
 * Example: `Host(\`api.acme.abc1234.vsl-base.com\`)`.
 */
function traefikHostRule(slug: string, hash: string): string {
  return `Host(\`${fluxTenantPostgrestHostname(slug, hash)}\`)`;
}

/**
 * Built-in CORS allow-list: Flux dashboard (`http://localhost:3001` for dev,
 * `https://app.<FLUX_DOMAIN|vsl-base.com>` for prod). When `FLUX_DOMAIN` is set,
 * each tenant’s production app UI at `https://<slug>.<FLUX_DOMAIN>` is also allowed.
 * Tenant apps add more origins via {@link FLUX_CORS_EXTRA_ORIGINS_LABEL} or the global
 * {@link FLUX_EXTRA_ALLOWED_ORIGINS_ENV} env var (see {@link resolveCorsAllowOriginList}).
 */
function traefikDashboardOrigins(): readonly string[] {
  return ["http://localhost:3001", `https://app.${fluxTenantDomain()}`];
}

/**
 * Per-tenant Docker label that persists the extra CORS allow-origins list across container
 * recreates. Comma-separated, trimmed origins. Empty / missing means "no extras".
 */
const FLUX_CORS_EXTRA_ORIGINS_LABEL = "flux.cors.extra_origins";

/**
 * Control-plane env var: comma-separated origins applied as extras to **every** tenant's
 * CORS allow-list. Useful when you operate the whole fleet (e.g. `https://app.example.com`,
 * `http://localhost:3000`) and want one place to allow them. Per-project label is unioned on top.
 */
const FLUX_EXTRA_ALLOWED_ORIGINS_ENV = "FLUX_EXTRA_ALLOWED_ORIGINS";

/**
 * Splits a comma-separated origin list into a deduped, trimmed array. Drops empty entries; does
 * **not** validate URL shape (Traefik tolerates `http://localhost:3001` and `https://a.example`).
 */
export function parseAllowedOriginsList(
  raw: string | null | undefined,
): readonly string[] {
  if (raw == null) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed.length > 0) seen.add(trimmed);
  }
  return Array.from(seen);
}

/** Inverse of {@link parseAllowedOriginsList}. Stable order = first-seen. */
export function serializeAllowedOriginsList(
  origins: readonly string[],
): string {
  return Array.from(new Set(origins.map((o) => o.trim()).filter(Boolean))).join(
    ",",
  );
}

/**
 * Resolves the full CORS `Access-Control-Allow-Origin` allow-list for a tenant's PostgREST router:
 * built-in dashboard origins ∪ (when `FLUX_DOMAIN` is set) `https://<slug>.<FLUX_DOMAIN>` ∪
 * control-plane {@link FLUX_EXTRA_ALLOWED_ORIGINS_ENV} ∪ per-project extras (from the
 * {@link FLUX_CORS_EXTRA_ORIGINS_LABEL} label or an explicit override). Order follows insertion
 * (dashboard first), deduped.
 */
function resolveCorsAllowOriginList(
  perProjectExtras: readonly string[],
  slug: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (origin: string) => {
    const trimmed = origin.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };
  for (const o of traefikDashboardOrigins()) push(o);
  if (fluxApiHttpsForTenantUrls()) {
    push(`https://${slug}.${fluxTenantDomain()}`);
  }
  for (const o of parseAllowedOriginsList(
    process.env[FLUX_EXTRA_ALLOWED_ORIGINS_ENV],
  )) {
    push(o);
  }
  for (const o of perProjectExtras) push(o);
  return out;
}

/**
 * Per-project Traefik middleware names scoped by random project hash + slug so multiple users on
 * one Traefik instance never collide (Traefik v3 treats middleware names as a global namespace).
 */
function traefikCorsMiddlewareName(hash: string, slug: string): string {
  return `${fluxTenantStackBaseId(hash, slug)}-cors`;
}

function traefikStripMiddlewareName(hash: string, slug: string): string {
  return `${fluxTenantStackBaseId(hash, slug)}-stripprefix`;
}

/** HTTPS origins for deployed apps under {@link fluxTenantDomain} (e.g. YeastCoast at `https://slug.domain`). */
function fleetHttpsOriginsRegex(domain: string): string {
  const escaped = domain.replace(/\\/g, "\\\\").replace(/\./g, "\\.");
  return `^https://.+\\.${escaped}$`;
}

/** Supabase JS + PostgREST (explicit list; no wildcard). */
const TRAEFIK_CORS_ALLOW_HEADERS =
  "apikey,Authorization,Content-Type,X-Client-Info,Accept-Profile,Content-Profile,Prefer,Accept,Range";

/** PostgREST `db-schemas`: default `api`; include `public` for Supabase-style dumps. */
const PGRST_DB_SCHEMAS_VALUE = "api,public";

/**
 * Traefik labels for the tenant PostgREST router (shared by provision and label updates).
 *
 * **Naming rule (global-hash namespacing — keep absolutely consistent with the hostname):**
 *   - Router / service id   `flux-${hash}-${slug}-api`
 *   - CORS middleware id    `flux-${hash}-${slug}-cors`
 *   - Strip middleware id   `flux-${hash}-${slug}-stripprefix`
 *   - Router rule           ``Host(`api.${slug}.${hash}.${domain}`)``
 *
 * All four share the same `flux-${hash}-${slug}` base ({@link fluxTenantStackBaseId}) and the
 * hostname produced by {@link fluxTenantPostgrestHostname} so Traefik can never mismatch a
 * router’s `.rule` with its `.service`.
 *
 * `perProjectExtraOrigins` is layered on top of the built-in dashboard origins and
 * {@link FLUX_EXTRA_ALLOWED_ORIGINS_ENV}; the resolved list is stamped both into the Traefik
 * `accesscontrolalloworiginlist` middleware **and** the {@link FLUX_CORS_EXTRA_ORIGINS_LABEL}
 * label so the next reconcile/recreate can read it back without callers re-passing it.
 */
function postgrestTraefikDockerLabels(
  slug: string,
  hash: string,
  stripSupabaseRestPrefix: boolean,
  perProjectExtraOrigins: readonly string[] = [],
): Record<string, string> {
  const traefikSvc = `${fluxTenantStackBaseId(hash, slug)}-api`;
  const corsMw = traefikCorsMiddlewareName(hash, slug);
  const stripMw = traefikStripMiddlewareName(hash, slug);
  const useEdgeTls = fluxTraefikCertResolverName() != null;
  const labels: Record<string, string> = {
    "traefik.enable": "true",
    "traefik.docker.network": FLUX_NETWORK_NAME,
    [`traefik.http.routers.${traefikSvc}.rule`]: traefikHostRule(slug, hash),
    [`traefik.http.routers.${traefikSvc}.entrypoints`]: useEdgeTls
      ? "websecure"
      : "web",
    [`traefik.http.routers.${traefikSvc}.service`]: traefikSvc,
    [`traefik.http.services.${traefikSvc}.loadbalancer.server.port`]: "3000",
    // Beat low-priority edge catch-alls (e.g. static nginx on `*.domain`) regardless of rule-length defaults.
    [`traefik.http.routers.${traefikSvc}.priority`]: "100",
  };
  if (useEdgeTls) {
    // Router only on `websecure` with explicit ACME resolver — avoids Traefik "default" cert.
    labels[`traefik.http.routers.${traefikSvc}.tls`] = "true";
    labels[`traefik.http.routers.${traefikSvc}.tls.certresolver`] =
      FLUX_TRAEFIK_ACME_RESOLVER;
  }

  labels[`traefik.http.middlewares.${stripMw}.stripprefix.prefixes`] = "/rest/v1";

  const allowOriginList = resolveCorsAllowOriginList(perProjectExtraOrigins, slug);
  labels[`traefik.http.middlewares.${corsMw}.headers.accesscontrolalloworiginlist`] =
    allowOriginList.join(",");
  labels[`traefik.http.middlewares.${corsMw}.headers.accesscontrolalloworiginlistregex`] =
    fleetHttpsOriginsRegex(fluxTenantDomain());
  labels[`traefik.http.middlewares.${corsMw}.headers.accesscontrolallowmethods`] =
    "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD";
  labels[`traefik.http.middlewares.${corsMw}.headers.accesscontrolallowheaders`] =
    TRAEFIK_CORS_ALLOW_HEADERS;
  labels[`traefik.http.middlewares.${corsMw}.headers.accesscontrolmaxage`] = "86400";
  labels[`traefik.http.middlewares.${corsMw}.headers.addvaryheader`] = "true";

  // Persist the per-project extras (NOT the dashboard / env-var origins — those are recomputed
  // on every label rebuild). Empty string when no extras so the label is still present and
  // contributes to the config hash deterministically.
  labels[FLUX_CORS_EXTRA_ORIGINS_LABEL] =
    serializeAllowedOriginsList(perProjectExtraOrigins);

  const middlewares = stripSupabaseRestPrefix
    ? `${corsMw},${stripMw}`
    : corsMw;
  labels[`traefik.http.routers.${traefikSvc}.middlewares`] = middlewares;

  return { ...labels, ...fluxContainerMetadataLabels(slug) };
}

/**
 * Strips **all** Traefik labels off a tenant container so the router/service/middleware set can
 * be re-stamped cleanly. Preserves non-Traefik labels and the persisted
 * {@link FLUX_CORS_EXTRA_ORIGINS_LABEL} (read back by {@link mergedPostgrestTraefikDockerLabels}).
 *
 * Intentionally **not** scoped to the current `flux-${hash}-${slug}-*` namespace: legacy Flux
 * installations stamped router/middleware names without the project hash segment (e.g.
 * `flux-${slug}-api`, `flux-${slug}-cors`, `flux-${slug}-stripprefix`). Leaving any of those
 * behind collides with the new hashed namespace under Traefik v3 (which treats router, service,
 * and middleware names as global) and is a known cause of `404 Service Not Found` after a
 * migration — both the old and new definitions race, and the legacy ones keep pointing at a
 * hostname/port that no longer exists. Wiping the entire `traefik.*` surface is the only safe,
 * idempotent answer for a catalog that mixes pre- and post-hash containers.
 */
function stripAllTraefikLabelsPreservingFluxExtras(
  existing: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(existing)) {
    if (k === FLUX_CORS_EXTRA_ORIGINS_LABEL) {
      out[k] = v;
      continue;
    }
    if (k === "traefik.enable") continue;
    if (k === "traefik.docker.network") continue;
    if (k.startsWith("traefik.")) continue;
    if (LEGACY_UMBRELLA_DOCKER_LABEL_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Rebuilds the tenant PostgREST router labels, preserving the **per-project** CORS extras across
 * recreates by reading them back from the {@link FLUX_CORS_EXTRA_ORIGINS_LABEL} on the existing
 * container. Pass `extraOriginsOverride` (e.g. from the `flux cors` CLI) to **replace** the
 * persisted list with the new one; omit it to carry the existing list forward unchanged.
 */
function mergedPostgrestTraefikDockerLabels(
  existing: Record<string, string>,
  slug: string,
  hash: string,
  stripSupabaseRestPrefix: boolean,
  extraOriginsOverride?: readonly string[],
): Record<string, string> {
  const extras =
    extraOriginsOverride ??
    parseAllowedOriginsList(existing[FLUX_CORS_EXTRA_ORIGINS_LABEL]);
  return {
    ...stripAllTraefikLabelsPreservingFluxExtras(existing),
    ...postgrestTraefikDockerLabels(
      slug,
      hash,
      stripSupabaseRestPrefix,
      extras,
    ),
  };
}

/**
 * Dev/ops aid: emits the generated Traefik label set so an operator can eyeball the router,
 * service, middleware, and host rule we just stamped on a tenant PostgREST container. Helpful
 * when diagnosing `404 Service Not Found` after a hash migration — the labels that Traefik
 * actually sees live on the container, and this is the only place we have them assembled.
 */
function logTraefikLabelsForTenant(
  stage: string,
  slug: string,
  hash: string,
  labels: Record<string, string>,
  onStatus?: (message: string) => void,
): void {
  const sink = onStatus ?? ((m: string) => { console.log(m); });
  const header = `[flux] Traefik labels (${stage}) for ${fluxTenantStackBaseId(hash, slug)} → ${fluxTenantPostgrestHostname(slug, hash)}`;
  sink(header);
  const keys = Object.keys(labels).sort((a, b) => a.localeCompare(b));
  for (const k of keys) {
    sink(`    ${k} = ${labels[k] ?? ""}`);
  }
}

function dockerLabelsSatisfy(
  required: Record<string, string>,
  current: Record<string, string> | undefined,
): boolean {
  for (const [k, v] of Object.entries(required)) {
    if (current?.[k] !== v) return false;
  }
  return true;
}

/**
 * Stricter than {@link dockerLabelsSatisfy}: also fails if `current` has any `traefik.*` label
 * that is **not** in `required`. Prevents legacy (pre-hash) router / middleware labels from
 * silently surviving a reconcile pass because the new label set happens to be a strict subset
 * of whatever was on the container before the hash-namespacing refactor landed.
 */
function traefikLabelsExactlyMatch(
  required: Record<string, string>,
  current: Record<string, string> | undefined,
): boolean {
  if (!dockerLabelsSatisfy(required, current)) return false;
  if (!current) return true;
  for (const k of Object.keys(current)) {
    if (!k.startsWith("traefik.")) continue;
    if (!(k in required)) return false;
  }
  return true;
}

/** Flux tenant containers: `flux-{7hex}-{slug}-db|api` */
const FLUX_TENANT_CONTAINER = new RegExp(
  `^flux-([a-f0-9]{${String(FLUX_PROJECT_HASH_HEX_LEN)}})-(.+)-(db|api)$`,
);

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

type ContainerLifecycleState = "running" | "stopped" | "missing";

async function inspectContainerLifecycleState(
  docker: Docker,
  name: string,
): Promise<ContainerLifecycleState> {
  try {
    const inspect = await docker.getContainer(name).inspect();
    return inspect.State.Running ? "running" : "stopped";
  } catch (err: unknown) {
    if (getHttpStatus(err) === 404) return "missing";
    throw err;
  }
}

/** Sensitive tenant credentials — use {@link ProjectManager.getProjectCredentials} only when needed. */
export type FluxProjectCredentials = {
  postgresConnectionString: string;
  anonKey: string;
  serviceRoleKey: string;
};

/** Catalog row from the flux-system `projects` table (control-plane metadata DB). */
export interface FluxSystemProjectActivity {
  id: string;
  name: string;
  slug: string;
  lastAccessedAt: Date;
  /** `true` when {@link FluxSystemProjectActivity.lastAccessedAt} is older than `maxAgeDays` passed to {@link ProjectManager.stopInactiveProjects}. */
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

function postgresJdbcUri(
  hash: string,
  slug: string,
  password: string,
): string {
  const host = postgresContainerName(hash, slug);
  const user = encodeURIComponent(POSTGRES_USER);
  const pass = encodeURIComponent(password);
  return `postgres://${user}:${pass}@${host}:5432/postgres`;
}

/**
 * Connection URI using the Postgres container’s Docker DNS name (reachable from containers on
 * {@link FLUX_NETWORK_NAME}, not from arbitrary hosts unless routed onto that network).
 */
function postgresDockerInternalUri(containerName: string, password: string): string {
  const user = encodeURIComponent(POSTGRES_USER);
  const pass = encodeURIComponent(password);
  return `postgres://${user}:${pass}@${containerName}:5432/postgres`;
}

/** Describes a fully provisioned Flux tenant: PostgREST on the shared + private networks; DB on the private network only. */
export interface FluxProject {
  /** Display name supplied to `provisionProject`. */
  name: string;
  /** Normalized identifier used in container names (e.g. `my-app` → `flux-{hash}-my-app-db`). */
  slug: string;
  /** Random per-project 7-hex id embedded in Docker names and the public API hostname. */
  hash: string;
  /**
   * Traefik-facing user-defined bridge (e.g. `flux-network`). PostgREST attaches here and to
   * {@link privateNetworkName}. Tenant Postgres is only on the private network; the **`flux-system`**
   * Postgres is also on this bridge so the control plane can open a TCP `pg` `Pool` to the catalog.
   */
  networkName: string;
  /**
   * Isolated **internal** bridge (`flux-{hash}-{slug}-net`) shared by this project’s DB and API only.
   * `PGRST_DB_URI` uses the Postgres container name, which is resolvable on this network.
   */
  privateNetworkName: string;
  postgres: {
    containerId: string;
    /**
     * Docker DNS hostname (same on the private network). Not reachable from arbitrary containers on
     * {@link networkName} because Postgres is not attached there.
     */
    containerName: string;
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
   * When true, the gateway chains per-tenant CORS + `flux-<hash>-<slug>-stripprefix` for `/rest/v1` (see {@link ProvisionOptions.stripSupabaseRestPrefix}).
   */
  stripSupabaseRestPrefix: boolean;
}

/**
 * Optional hooks for long-running {@link ProjectManager.provisionProject} work (CLIs, logs).
 *
 * **Control-plane env (read during provision, not fields here):**
 * - **`FLUX_DEV_POSTGRES_PASSWORD`** — when non-empty, derives a stable Postgres password from this
 *   secret and the tenant volume name so `POSTGRES_PASSWORD` and `PGRST_DB_URI` always match (dev/test only).
 * - **`FLUX_RESET_TENANT_VOLUME`** — when truthy (`1` / `true` / `yes`), removes the tenant PostgREST +
 *   Postgres containers and the data volume before creating a fresh `PGDATA` (ignored for `flux-system`).
 */
export interface ProvisionOptions {
  onStatus?: (message: string) => void;
  /**
   * When set (e.g. Clerk or NextAuth JWT signing secret), used as `PGRST_JWT_SECRET` for PostgREST
   * so the tenant API can verify tokens minted by your auth provider. If omitted, a random secret is generated.
   */
  customJwtSecret?: string;
  /**
   * When true (default), the tenant router chains per-tenant CORS (dashboard + when `FLUX_DOMAIN` is set
   * `https://<slug>.<FLUX_DOMAIN>` + env extras + HTTPS `*.domain` regex) and `flux-<hash>-<slug>-stripprefix`
   * so the Supabase JS client’s `/rest/v1` path reaches PostgREST.
   * Set to false only if clients call PostgREST at the URL root with no `/rest/v1` prefix.
   */
  stripSupabaseRestPrefix?: boolean;
  /**
   * When true, {@link ProjectManager.provisionProject} returns an `https://` {@link FluxProject.apiUrl}
   * (alongside `https://` when `FLUX_DOMAIN` is set). When false and `FLUX_DOMAIN` is unset, returns
   * `http://` (typical local dev).
   */
  isProduction?: boolean;
  /**
   * Per-project CORS extra allow-origins (e.g. `["https://app.example.com", "http://localhost:3000"]`)
   * unioned on top of the built-in dashboard origins and the global
   * `FLUX_EXTRA_ALLOWED_ORIGINS` env var, and the automatic `https://<slug>.<FLUX_DOMAIN>` origin when
   * `FLUX_DOMAIN` is set. Persisted extras only (not the built-ins) on the PostgREST container via the
   * {@link FLUX_CORS_EXTRA_ORIGINS_LABEL} label so subsequent reconciles preserve them.
   *
   * Pass `[]` (empty array) to **clear** previously persisted per-project extras. Omit to
   * carry the persisted list forward unchanged.
   */
  additionalAllowedOrigins?: readonly string[];
}

/** Required for {@link ProjectManager.nukeProject} — confirms permanent data loss. */
export interface NukeProjectOptions {
  acknowledgeDataLoss: true;
  /** Per-project hash from the flux-system `projects.hash` column for this stack. */
  hash: string;
}

/**
 * Success from {@link ProjectManager.deleteProjectInfrastructure} — Docker API data volume is
 * confirmed absent (404) after the delete attempt.
 */
export type DeleteProjectInfrastructureResult = {
  ok: true;
  removed: {
    apiContainer: string;
    dbContainer: string;
    volume: string;
    privateNetwork: string;
  };
};

/** Catalog slug + per-project hash for Docker lookups (e.g. dashboard session user). */
export type FluxProjectSlugRef = { slug: string; hash: string };

/**
 * How {@link ProjectManager} connects to the Docker Engine API.
 *
 * **Precedence:** Injected {@link ProjectManagerConnectOptions.docker} wins; else if
 * {@link ProjectManagerConnectOptions.host} is set, a client is built for that remote endpoint; else
 * {@link createFluxDocker} uses `new Docker()`, which applies **`DOCKER_HOST`** (including
 * `unix://`, `tcp://`, TLS env vars, and **`ssh://user@host`** via docker-modem + ssh2) the same way
 * as the Docker CLI.
 */
export interface ProjectManagerConnectOptions {
  /** Use a pre-configured client (tests, custom modem options). */
  docker?: Docker;
  /** Remote Engine hostname or IP (not a `ssh://` URL — use {@link protocol} `ssh` instead). */
  host?: string;
  /** Engine API port; defaults by protocol: HTTP `2375`, HTTPS `2376`, SSH `22`. */
  port?: number | string;
  /** When omitted with a TCP {@link host}, defaults to `http`. */
  protocol?: "http" | "https" | "ssh";
  /** SSH login when {@link protocol} is `ssh` (docker-modem `username`). */
  username?: string;
  /**
   * Extra ssh2 connect options merged with modem defaults (`SSH_AUTH_SOCK` agent when set).
   * See ssh2 `ConnectConfig` — common keys include `agent`, `privateKey`, `tryKeyboard`, etc.
   * For file-based keys without an agent, **`FLUX_DOCKER_SSH_IDENTITY`** is also supported.
   */
  sshOptions?: Record<string, unknown>;
}

function assertNoRemoteFieldsWithoutHost(opts: ProjectManagerConnectOptions): void {
  const hasHost = opts.host != null && String(opts.host).trim() !== "";
  if (hasHost) return;
  if (
    opts.port != null ||
    opts.protocol != null ||
    opts.username != null ||
    opts.sshOptions != null
  ) {
    throw new TypeError(
      "ProjectManagerConnectOptions: `host` is required when `port`, `protocol`, `username`, or `sshOptions` is set",
    );
  }
}

function defaultSshAgentOptions(): Record<string, unknown> {
  const agent = process.env.SSH_AUTH_SOCK;
  return agent ? { agent } : {};
}

function expandUserPath(p: string): string {
  if (p === "~" || p.startsWith("~/")) {
    return path.join(homedir(), p === "~" ? "" : p.slice(2));
  }
  return p;
}

/**
 * Loads a private key file for Docker-over-SSH when **no ssh-agent** is in use.
 *
 * If **`SSH_AUTH_SOCK`** is set, returns nothing so **ssh-agent** (e.g. after `ssh-add`) is used
 * alone — avoids ssh2 trying to parse an **encrypted** `~/.ssh/id_ed25519` while your real identity
 * lives in the agent.
 *
 * Otherwise: **`FLUX_DOCKER_SSH_IDENTITY`** (path, `~` allowed) if set, else `~/.ssh/id_ed25519`.
 */
function maybeAutoSshPrivateKeyFileOption(): { privateKey: Buffer } | Record<string, never> {
  if (process.env.SSH_AUTH_SOCK?.trim()) {
    return {};
  }
  try {
    const raw = process.env.FLUX_DOCKER_SSH_IDENTITY?.trim();
    const keyPath = raw
      ? expandUserPath(raw)
      : path.join(homedir(), ".ssh", "id_ed25519");
    if (!existsSync(keyPath)) return {};
    return { privateKey: readFileSync(keyPath) };
  } catch {
    return {};
  }
}

/** Default ssh2 keepalive so idle SSH (e.g. Hetzner) does not drop between docker execs. Tighter than 10s. */
const FLUX_SSH_KEEPALIVE_INTERVAL_MS = 5_000;

function mergeSshOptionsForSshProtocol(user?: Record<string, unknown>): Record<string, unknown> {
  const keepaliveBase = { keepaliveInterval: FLUX_SSH_KEEPALIVE_INTERVAL_MS };
  const agentPart = defaultSshAgentOptions();
  const keyPart =
    user?.privateKey !== undefined ? {} : maybeAutoSshPrivateKeyFileOption();
  return { ...keepaliveBase, ...agentPart, ...keyPart, ...user };
}

/** Ensures Docker-over-SSH clients send periodic channel keepalives (ssh2 `keepaliveInterval`). */
function applySshEngineKeepalives(docker: Docker): void {
  const m = docker.modem as {
    protocol?: string;
    sshOptions?: Record<string, unknown>;
  };
  if (m.protocol !== "ssh") return;
  const cur = m.sshOptions ?? {};
  if (cur.keepaliveInterval !== undefined && cur.keepaliveInterval !== null) {
    return;
  }
  m.sshOptions = { ...cur, keepaliveInterval: FLUX_SSH_KEEPALIVE_INTERVAL_MS };
}

/**
 * If this client uses SSH to reach the Engine and no `privateKey` was configured, may merge a
 * key file — skipped when an **agent** is already configured or **`SSH_AUTH_SOCK`** is set (see
 * {@link maybeAutoSshPrivateKeyFileOption}).
 */
function augmentDockerSshClientIfNeeded(docker: Docker): void {
  const m = docker.modem as {
    protocol?: string;
    sshOptions?: Record<string, unknown>;
  };
  if (m.protocol !== "ssh") return;
  const cur = m.sshOptions ?? {};
  if (cur.privateKey !== undefined) return;
  if (cur.agent != null && String(cur.agent).length > 0) return;
  const extra = maybeAutoSshPrivateKeyFileOption();
  if (!("privateKey" in extra)) return;
  m.sshOptions = mergeSshOptionsForSshProtocol({ ...cur, ...extra });
}

type DockerCtorOptions = NonNullable<ConstructorParameters<typeof Docker>[0]>;

function buildExplicitModemOptions(
  options: ProjectManagerConnectOptions & { host: string },
): DockerCtorOptions {
  const host = options.host.trim();
  const protocol = options.protocol ?? "http";
  let port = options.port;
  if (port == null || port === "") {
    if (protocol === "https") port = 2376;
    else if (protocol === "ssh") port = 22;
    else port = 2375;
  }
  const portStr = typeof port === "number" ? String(port) : String(port);

  if (protocol === "ssh") {
    return {
      host,
      port: portStr,
      protocol: "ssh",
      pathPrefix: "/",
      username: options.username,
      sshOptions: mergeSshOptionsForSshProtocol(options.sshOptions),
    } as DockerCtorOptions;
  }

  return {
    host,
    port: portStr,
    protocol,
    pathPrefix: "/",
  } as DockerCtorOptions;
}

/**
 * Creates a dockerode client from optional {@link ProjectManagerConnectOptions}.
 * With no options (or no `host` / `docker`), uses `new Docker()` so **`DOCKER_HOST`** and the
 * default local socket behave like the Docker CLI.
 *
 * For **`protocol: 'ssh'`** or **`DOCKER_HOST=ssh://…`**: when **`SSH_AUTH_SOCK`** is unset, may
 * merge **`FLUX_DOCKER_SSH_IDENTITY`** or `~/.ssh/id_ed25519` as `sshOptions.privateKey`. When the
 * agent is in use, only the agent is used (encrypted default keys are not loaded from disk).
 * SSH clients get **`keepaliveInterval: 5000`** (5s) unless already set, to reduce idle drops
 * through firewalls during long operations.
 */
export function createFluxDocker(
  options?: ProjectManagerConnectOptions,
): Docker {
  if (options?.docker) {
    augmentDockerSshClientIfNeeded(options.docker);
    applySshEngineKeepalives(options.docker);
    return options.docker;
  }
  assertNoRemoteFieldsWithoutHost(options ?? {});
  const trimmed = options?.host?.trim();
  if (trimmed) {
    const d = new Docker(
      buildExplicitModemOptions({ ...options, host: trimmed }),
    );
    augmentDockerSshClientIfNeeded(d);
    applySshEngineKeepalives(d);
    return d;
  }
  const d = new Docker();
  augmentDockerSshClientIfNeeded(d);
  applySshEngineKeepalives(d);
  return d;
}

/** Human-readable Engine target for logs (prefers `DOCKER_HOST` when set). */
export function formatDockerEngineTarget(docker: Docker): string {
  const dh = process.env.DOCKER_HOST?.trim();
  if (dh) return dh;
  const m = docker.modem as {
    host?: string;
    port?: number | string;
    protocol?: string;
    username?: string;
  };
  if (m.host) {
    const auth = m.username ? `${m.username}@` : "";
    const portPart =
      m.port != null && m.port !== "" ? `:${String(m.port)}` : "";
    return `${String(m.protocol ?? "http")}://${auth}${m.host}${portPart}`;
  }
  return "local-socket (DOCKER_HOST unset; default unix socket or Windows named pipe)";
}

/**
 * When true, Flux refuses to proceed if the Engine cannot be reached (avoids silently using a
 * different daemon than `DOCKER_HOST` / explicit remote options imply).
 */
export function dockerEngineRequiresStrictReachability(docker: Docker): boolean {
  if (process.env.DOCKER_HOST?.trim()) return true;
  const m = docker.modem as { host?: string };
  return Boolean(m.host);
}

/**
 * If {@link dockerEngineRequiresStrictReachability} is true, **`docker.ping()`** must succeed or
 * this throws (no fallback to another socket).
 */
export async function assertFluxDockerEngineReachableOrThrow(
  docker: Docker,
): Promise<void> {
  if (!dockerEngineRequiresStrictReachability(docker)) return;
  try {
    await docker.ping();
  } catch (err: unknown) {
    const target = formatDockerEngineTarget(docker);
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Flux: cannot reach Docker Engine "${target}" (ping failed: ${detail}). ` +
        "DOCKER_HOST is set or a remote host was configured—aborting so we never fall back to a different engine.",
    );
  }
}

function resolveProjectManagerDocker(
  arg?: Docker | ProjectManagerConnectOptions,
): Docker {
  if (arg instanceof Docker) {
    augmentDockerSshClientIfNeeded(arg);
    applySshEngineKeepalives(arg);
    return arg;
  }
  return createFluxDocker(arg);
}

/**
 * Orchestrates Docker resources for Flux projects: shared network, Postgres, PostgREST.
 *
 * Pass a {@link Docker} instance, {@link ProjectManagerConnectOptions} (remote `host` / `protocol`,
 * or injected `docker`), or omit the argument to use {@link createFluxDocker} (`DOCKER_HOST` + default
 * socket, same as the Docker CLI).
 *
 * When **`DOCKER_HOST`** is set or a remote **`host`** was passed, {@link provisionProject} (and
 * {@link assertDockerEngineReachableOrThrow}) **ping** that Engine first and **throw** if it is
 * unreachable—there is no fallback to `/var/run/docker.sock`.
 */
export class ProjectManager {
  private readonly docker: Docker;

  constructor(docker?: Docker);
  constructor(options?: ProjectManagerConnectOptions);
  constructor(arg?: Docker | ProjectManagerConnectOptions) {
    this.docker = resolveProjectManagerDocker(arg);
  }

  /**
   * Verifies the configured Engine responds to **`ping`** when strict remote mode applies
   * ({@link dockerEngineRequiresStrictReachability}); no-op for local-socket-only setups.
   */
  async assertDockerEngineReachableOrThrow(): Promise<void> {
    await assertFluxDockerEngineReachableOrThrow(this.docker);
  }

  /**
   * **Control room** telemetry: `docker info` for container count, `os` for RAM % and 1m load.
   */
  async getNodeStats(): Promise<FluxNodeStats> {
    const info = (await this.docker.info()) as { Containers?: number };
    const containerCount: number =
      typeof info.Containers === "number" && info.Containers >= 0
        ? info.Containers
        : (await this.docker.listContainers({ all: true })).length;
    const total = totalmem();
    const used = total - freemem();
    const memoryUsage =
      total > 0
        ? Math.min(100, Math.round((1000 * used) / total) / 10)
        : 0;
    const oneMin = loadavg()[0] ?? 0;
    const cpuLoad = Number.isFinite(oneMin) ? oneMin : 0;
    return { containerCount, memoryUsage, cpuLoad };
  }

  /** Docker DNS names for Postgres and PostgREST (Postgres reachable on the tenant private network only). */
  static containerNamesForSlug(
    slug: string,
    hash: string,
  ): {
    postgres: string;
    postgrest: string;
  } {
    const normalized = slugifyProjectName(slug);
    return {
      postgres: postgresContainerName(hash, normalized),
      postgrest: postgrestContainerName(hash, normalized),
    };
  }

  /**
   * Provisions Postgres on an **internal** per-tenant private bridge (`flux-{hash}-{slug}-net`) and
   * PostgREST on that private network **and** {@link FLUX_NETWORK_NAME} (Traefik). Prevents other
   * `flux-network` services from reaching tenant Postgres. Resource caps and
   * {@link FLUX_MANAGED_LABEL} / purpose labels are applied to both containers.
   *
   * A Traefik instance named {@link FLUX_GATEWAY_CONTAINER_NAME} (managed outside this API, e.g. Compose)
   * on {@link FLUX_NETWORK_NAME} routes `api.{slug}.{hash}.<FLUX_DOMAIN|vsl-base.com>` to PostgREST via Docker labels; PostgREST is not published
   * on a random host port. By default, Traefik chains per-tenant Headers (CORS) middleware for
   * `http://localhost:3001`, `https://app.<domain>`, when `FLUX_DOMAIN` is set `https://<slug>.<domain>`,
   * HTTPS apps matching `*.domain`, extras, and `flux-<hash>-<slug>-stripprefix` for `/rest/v1` (Supabase JS).
   * Disable strip with {@link ProvisionOptions.stripSupabaseRestPrefix} `false` if clients use PostgREST at the URL root only.
   *
   * Postgres is **not** published on the Docker host by default: bootstrap SQL and health checks use
   * **`docker exec`** (`pg_isready`, `psql`) inside the DB container so provisioning works with
   * remote Engine endpoints (no `localhost:5432` from the control plane). For **`flux-system`** only,
   * set **`FLUX_SYSTEM_POSTGRES_PUBLISH_PORT`** (e.g. `15432`) to map `127.0.0.1:<port>→5432` so
   * host-run tools (`@flux/gateway` with `pnpm start`, `psql`) can reach the catalog DB. Likewise
   * **`FLUX_SYSTEM_POSTGREST_PUBLISH_PORT`** maps `127.0.0.1:<port>→3000` for `FLUX_POSTGREST_POOL_URL`.
   *
   * `PGRST_DB_URI` points at the Postgres service name; PostgREST resolves it on the private network.
   * Internal readiness uses `pg_isready` in-container before applying {@link BOOTSTRAP_SQL}.
   *
   * **Resume:** If the Postgres or PostgREST container already exists (by name), Flux **adopts** it
   * (reads secrets from inspect, starts if stopped) and continues bootstrap—no error, whether the
   * prior run failed after create or only partially completed. Adopted stacks are realigned to the
   * private + bridge network layout.
   */
  async provisionProject(
    name: string,
    options?: ProvisionOptions,
    hash?: string,
  ): Promise<FluxProject> {
    const log = options?.onStatus;
    const targetBody = `Targeting Docker Engine: ${formatDockerEngineTarget(this.docker)}`;
    if (log) {
      log(targetBody);
    } else {
      console.log(`▸ ${targetBody}`);
    }
    await assertFluxDockerEngineReachableOrThrow(this.docker);
    await this.ensureFluxNetwork(log);
    await this.ensureFluxGateway(log);
    const slug = slugifyProjectName(name);
    const projectHash = hash ?? generateProjectHash();
    const privateNet = await this.ensureProjectPrivateNetwork(
      projectHash,
      slug,
      log,
    );
    const trimmedCustomJwt = options?.customJwtSecret?.trim();
    let jwtSecret =
      trimmedCustomJwt && trimmedCustomJwt.length > 0
        ? trimmedCustomJwt
        : randomHexChars(32);

    const volumeName = tenantVolumeName(projectHash, slug);
    const pgContainerName = postgresContainerName(projectHash, slug);
    const apiContainerName = postgrestContainerName(projectHash, slug);

    if (fluxResetTenantVolumeEnabled() && slug !== "flux-system") {
      log?.(
        `FLUX_RESET_TENANT_VOLUME: removing ${apiContainerName}, ${pgContainerName}, and volume ${volumeName} for a fresh Postgres data directory…`,
      );
      await removeApiPgAndVolumeForProvision(
        this.docker,
        apiContainerName,
        pgContainerName,
        volumeName,
        privateNet,
      );
    } else if (fluxResetTenantVolumeEnabled() && slug === "flux-system") {
      log?.(
        "FLUX_RESET_TENANT_VOLUME is ignored for the flux-system platform stack (would destroy the control-plane catalog).",
      );
    }

    log?.(`Ensuring volume ${volumeName}…`);
    await ensureNamedVolume(this.docker, volumeName);
    log?.("Ensuring container images…");
    await ensureImage(this.docker, POSTGRES_IMAGE, log);
    await ensureImage(this.docker, POSTGREST_IMAGE, log);

    let pgContainer: Docker.Container;
    const pgExisting = await fluxInspectContainerOrNull(
      this.docker,
      pgContainerName,
    );
    const devPgSecret = fluxDevPostgresPasswordSecret();
    let postgresPassword: string;
    if (devPgSecret) {
      postgresPassword = deterministicPostgresPasswordFromDevSecret(
        devPgSecret,
        volumeName,
      );
      if (pgExisting) {
        const pwLine = pgExisting.Config?.Env?.find((e) =>
          e.startsWith("POSTGRES_PASSWORD="),
        );
        const existingPw = pwLine?.slice("POSTGRES_PASSWORD=".length);
        if (!existingPw) {
          throw new Error(
            `Cannot adopt "${pgContainerName}": POSTGRES_PASSWORD missing from container env.`,
          );
        }
        if (existingPw !== postgresPassword) {
          throw new Error(
            `Postgres container "${pgContainerName}" uses a different password than FLUX_DEV_POSTGRES_PASSWORD derives for volume "${volumeName}". Set FLUX_RESET_TENANT_VOLUME=1 (or nuke the project) to wipe the volume and reprovision.`,
          );
        }
        log?.(
          `Postgres container "${pgContainerName}" already exists; resuming (start if stopped, then bootstrap)…`,
        );
        pgContainer = this.docker.getContainer(pgContainerName);
      } else {
        log?.(`Creating Postgres container ${pgContainerName}…`);
        pgContainer = await this.createPostgresContainerForProvision({
          name: pgContainerName,
          password: postgresPassword,
          volumeName,
          privateNet,
          slug,
        });
      }
    } else if (pgExisting) {
      log?.(
        `Postgres container "${pgContainerName}" already exists; resuming (start if stopped, then bootstrap)…`,
      );
      pgContainer = this.docker.getContainer(pgContainerName);
      const pwLine = pgExisting.Config?.Env?.find((e) =>
        e.startsWith("POSTGRES_PASSWORD="),
      );
      const pw = pwLine?.slice("POSTGRES_PASSWORD=".length);
      if (!pw) {
        throw new Error(
          `Cannot adopt "${pgContainerName}": POSTGRES_PASSWORD missing from container env.`,
        );
      }
      postgresPassword = pw;
    } else {
      postgresPassword = randomHexChars(16);
      log?.(`Creating Postgres container ${pgContainerName}…`);
      pgContainer = await this.createPostgresContainerForProvision({
        name: pgContainerName,
        password: postgresPassword,
        volumeName,
        privateNet,
        slug,
      });
    }

    log?.("Starting Postgres (if stopped)…");
    await startFluxContainerIfStopped(pgContainer);
    const pgInspect = await pgContainer.inspect();
    await this.alignPostgresToPrivateOnlyNetwork(pgInspect.Id, projectHash, slug, log);
    await this.applyTenantResourceLimits(pgInspect.Id, log);

    await waitPostgresReadyInsideContainer(
      this.docker,
      pgInspect.Id,
      log
        ? { onStatus: log, maxAttempts: 80 }
        : { maxAttempts: 80 },
    );
    await runPsqlSqlInsideContainer(
      this.docker,
      pgInspect.Id,
      postgresPassword,
      BOOTSTRAP_SQL,
      POSTGRES_USER,
    );
    log?.("Postgres is up; bootstrap SQL applied.");

    const dbUri = postgresJdbcUri(projectHash, slug, postgresPassword);

    const stripSupabaseRestPrefix = options?.stripSupabaseRestPrefix !== false;
    const additionalAllowedOrigins = options?.additionalAllowedOrigins;
    const traefikLabels = postgrestTraefikDockerLabels(
      slug,
      projectHash,
      stripSupabaseRestPrefix,
      additionalAllowedOrigins ?? [],
    );
    logTraefikLabelsForTenant(
      "provision",
      slug,
      projectHash,
      traefikLabels,
      log,
    );

    log?.("Post-Postgres stabilization (5s) before starting PostgREST on remote engines…");
    await sleep(5000);

    let apiContainer: Docker.Container;
    const apiExisting = await fluxInspectContainerOrNull(
      this.docker,
      apiContainerName,
    );
    if (apiExisting) {
      log?.(
        `PostgREST container "${apiContainerName}" already exists; resuming (start if stopped, reuse JWT)…`,
      );
      apiContainer = this.docker.getContainer(apiContainerName);
      jwtSecret = readPgrstJwtSecretFromContainerEnv(
        apiExisting,
        apiContainerName,
      );
      const mergedTraefik = mergedPostgrestTraefikDockerLabels(
        apiExisting.Config?.Labels ?? {},
        slug,
        projectHash,
        stripSupabaseRestPrefix,
        additionalAllowedOrigins,
      );
      logTraefikLabelsForTenant(
        "provision.adopt",
        slug,
        projectHash,
        mergedTraefik,
        log,
      );
      const apiEnv = envRecordFromDockerEnv(apiExisting.Config?.Env);
      const envWithDbUri = mergePostgrestEnvWithDbUri(apiEnv, dbUri);
      const labelsOutOfDate = !traefikLabelsExactlyMatch(
        mergedTraefik,
        apiExisting.Config?.Labels,
      );
      const dbUriOutOfDate = apiEnv.PGRST_DB_URI !== dbUri;

      if (labelsOutOfDate) {
        log?.(
          "PostgREST Traefik labels out of date; recreating API container to refresh gateway routing…",
        );
        await this.replacePostgrestApiContainer(
          slug,
          projectHash,
          apiExisting,
          envWithDbUri,
          { labels: mergedTraefik },
        );
        apiContainer = this.docker.getContainer(apiContainerName);
      } else if (dbUriOutOfDate) {
        log?.(
          "PostgREST PGRST_DB_URI does not match Postgres container hostname; recreating API container…",
        );
        await this.replacePostgrestApiContainer(
          slug,
          projectHash,
          apiExisting,
          envWithDbUri,
          { labels: mergedTraefik },
        );
        apiContainer = this.docker.getContainer(apiContainerName);
      }
    } else {
      log?.(`Creating PostgREST container ${apiContainerName}…`);
      const systemPgrstHostPort = fluxSystemPostgrestHostPublishPort(slug);
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
          ...tenantStackHostMemoryConfig(),
          NanoCpus: fluxTenantCpuNanoCpus(),
          RestartPolicy: FLUX_TENANT_RESTART_POLICY,
          ...(systemPgrstHostPort
            ? {
                PortBindings: {
                  "3000/tcp": [
                    {
                      HostIp: FLUX_SYSTEM_HOST_PORT_BIND,
                      HostPort: systemPgrstHostPort,
                    },
                  ],
                },
              }
            : {}),
        },
        NetworkingConfig: {
          EndpointsConfig: {
            [FLUX_NETWORK_NAME]: {},
            [privateNet]: {},
          },
        },
      });
    }

    log?.("Starting PostgREST (if stopped)…");
    await startFluxContainerIfStopped(apiContainer);
    const apiInspect = await apiContainer.inspect();
    await this.alignPostgrestToBridgeAndPrivate(apiInspect.Id, projectHash, slug, log);
    await this.applyTenantResourceLimits(apiInspect.Id, log);
    log?.(
      `Verified PostgREST is on ${FLUX_NETWORK_NAME} and ${privateNet} (Traefik + DB reachability).`,
    );

    const isProduction = options?.isProduction === true;
    const apiUrl = fluxApiUrlForSlug(slug, projectHash, isProduction);
    await waitForApiReachable(apiUrl, log ? { onStatus: log } : undefined);

    log?.("Provision complete.");
    return {
      name,
      slug,
      hash: projectHash,
      networkName: FLUX_NETWORK_NAME,
      privateNetworkName: privateNet,
      postgres: {
        containerId: pgInspect.Id,
        containerName: pgContainerName,
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
  async setProjectEnv(
    slug: string,
    envs: Record<string, string>,
    hash: string,
  ): Promise<void> {
    const normalized = slugifyProjectName(slug);
    const existing = await this.getPostgrestInspectOrThrow(normalized, hash);
    const merged = {
      ...envRecordFromDockerEnv(existing.Config.Env),
      ...envs,
    };
    await this.replacePostgrestApiContainer(
      normalized,
      hash,
      existing,
      merged,
    );
  }

  /**
   * Recreates the PostgREST container with updated Traefik labels so the gateway strips `/rest/v1`
   * before forwarding to PostgREST (required for the Supabase JS client’s default REST path), or
   * removes that middleware when `enabled` is false.
   */
  async setPostgrestSupabaseRestPrefix(
    projectName: string,
    enabled: boolean,
    hash: string,
  ): Promise<void> {
    const slug = slugifyProjectName(projectName);
    const existing = await this.getPostgrestInspectOrThrow(slug, hash);
    const merged = envRecordFromDockerEnv(existing.Config.Env);
    const labels = mergedPostgrestTraefikDockerLabels(
      existing.Config.Labels ?? {},
      slug,
      hash,
      enabled,
    );
    await this.replacePostgrestApiContainer(slug, hash, existing, merged, {
      labels,
    });
  }

  /**
   * Recreates the PostgREST container if the current per-tenant Traefik label set (TLS, entrypoints,
   * CORS, strip) does not match Docker, so a second `flux create` can sync the gateway. Idempotent.
   */
  async reconcilePostgrestTraefikLabels(
    projectName: string,
    hash: string,
    options?: {
      stripSupabaseRestPrefix?: boolean;
      /**
       * When provided, **replaces** the persisted per-project CORS extras (see
       * {@link ProvisionOptions.additionalAllowedOrigins}) with this list. Pass `[]` to clear.
       * Omit to carry the current persisted extras forward unchanged.
       */
      additionalAllowedOrigins?: readonly string[];
      onStatus?: (message: string) => void;
    },
  ): Promise<void> {
    const slug = slugifyProjectName(projectName);
    const log = options?.onStatus;
    const strip = options?.stripSupabaseRestPrefix !== false;
    const existing = await this.getPostgrestInspectOrThrow(slug, hash);
    const merged = mergedPostgrestTraefikDockerLabels(
      existing.Config?.Labels ?? {},
      slug,
      hash,
      strip,
      options?.additionalAllowedOrigins,
    );
    logTraefikLabelsForTenant("reconcile", slug, hash, merged, log);
    if (traefikLabelsExactlyMatch(merged, existing.Config?.Labels)) {
      log?.("PostgREST Traefik labels are already up to date.");
      return;
    }
    log?.("Syncing PostgREST Traefik labels and recreating API container…");
    const env = envRecordFromDockerEnv(existing.Config?.Env);
    await this.replacePostgrestApiContainer(slug, hash, existing, env, {
      labels: merged,
    });
    log?.("PostgREST API container updated with new Traefik labels.");
  }

  /**
   * Returns the per-project CORS extra allow-origins persisted on the PostgREST container via
   * the {@link FLUX_CORS_EXTRA_ORIGINS_LABEL} Docker label. Does **not** include the built-in
   * dashboard origins or {@link FLUX_EXTRA_ALLOWED_ORIGINS_ENV} extras — those are recomputed
   * on every reconcile from live config. Returns `[]` when nothing is persisted.
   */
  async getProjectAllowedOrigins(
    projectName: string,
    hash: string,
  ): Promise<readonly string[]> {
    const slug = slugifyProjectName(projectName);
    const existing = await this.getPostgrestInspectOrThrow(slug, hash);
    return parseAllowedOriginsList(
      existing.Config?.Labels?.[FLUX_CORS_EXTRA_ORIGINS_LABEL],
    );
  }

  /**
   * Replaces the project's persisted CORS extras with `origins` and recreates the PostgREST
   * container so Traefik picks up the new `accesscontrolalloworiginlist`. Pass `[]` to clear
   * per-project extras (the dashboard + env-var origins still apply). Idempotent: no restart
   * when the label set already matches.
   */
  async setProjectAllowedOrigins(
    projectName: string,
    origins: readonly string[],
    hash: string,
    options?: { onStatus?: (message: string) => void },
  ): Promise<void> {
    const reconcileOpts: Parameters<
      ProjectManager["reconcilePostgrestTraefikLabels"]
    >[2] = { additionalAllowedOrigins: origins };
    if (options?.onStatus) reconcileOpts.onStatus = options.onStatus;
    await this.reconcilePostgrestTraefikLabels(projectName, hash, reconcileOpts);
  }

  /**
   * Returns env entries from the PostgREST container. Sensitive keys omit values; use
   * {@link isFluxSensitiveEnvKey} for the rule set.
   */
  async listProjectEnv(slug: string, hash: string): Promise<FluxProjectEnvEntry[]> {
    const normalized = slugifyProjectName(slug);
    const inspect = await this.getPostgrestInspectOrThrow(normalized, hash);
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
    hash: string,
  ): Promise<void> {
    const secret = newJwtSecret.trim();
    if (!secret) {
      throw new Error("JWT secret cannot be empty.");
    }
    const slug = slugifyProjectName(projectName);
    await this.setProjectEnv(slug, { PGRST_JWT_SECRET: secret }, hash);
  }

  private async getPostgrestInspectOrThrow(
    slugOrName: string,
    hash: string,
  ): Promise<Awaited<ReturnType<Docker.Container["inspect"]>>> {
    const slug = slugifyProjectName(slugOrName);
    const apiName = postgrestContainerName(hash, slug);
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
   * Tenant Postgres: private network only. Platform `flux-system` Postgres: private + `flux-network`
   * so the control plane can connect without joining every tenant’s internal bridge.
   */
  private async createPostgresContainerForProvision(opts: {
    name: string;
    password: string;
    volumeName: string;
    privateNet: string;
    slug: string;
  }): Promise<Docker.Container> {
    const bind = `${opts.volumeName}:/var/lib/postgresql/data`;
    const hostBase = {
      Binds: [bind],
      ...tenantStackHostMemoryConfig(),
      NanoCpus: fluxTenantCpuNanoCpus(),
      RestartPolicy: FLUX_TENANT_RESTART_POLICY,
    };
    if (isPlatformSystemStackSlug(opts.slug)) {
      const systemPgHostPort = fluxSystemPostgresHostPublishPort(opts.slug);
      const hostConfig = systemPgHostPort
        ? {
            ...hostBase,
            PortBindings: {
              "5432/tcp": [
                {
                  HostIp: FLUX_SYSTEM_HOST_PORT_BIND,
                  HostPort: systemPgHostPort,
                },
              ],
            },
          }
        : hostBase;
      return await this.docker.createContainer({
        name: opts.name,
        Image: POSTGRES_IMAGE,
        Labels: fluxContainerMetadataLabels(opts.slug),
        Env: [`POSTGRES_PASSWORD=${opts.password}`],
        ...(systemPgHostPort ? { ExposedPorts: { "5432/tcp": {} } } : {}),
        HostConfig: hostConfig,
        NetworkingConfig: {
          EndpointsConfig: {
            [FLUX_NETWORK_NAME]: {},
            [opts.privateNet]: {},
          },
        },
      });
    }
    return await this.docker.createContainer({
      name: opts.name,
      Image: POSTGRES_IMAGE,
      Labels: fluxContainerMetadataLabels(opts.slug),
      Env: [`POSTGRES_PASSWORD=${opts.password}`],
      HostConfig: {
        ...hostBase,
        NetworkMode: opts.privateNet,
      },
    });
  }

  /**
   * Stops/removes the API container and creates a new one with `mergedEnv`, preserving Traefik
   * labels and host settings from `inspect` unless `replaceOptions.labels` is set.
   */
  private async replacePostgrestApiContainer(
    slug: string,
    hash: string,
    inspect: Awaited<ReturnType<Docker.Container["inspect"]>>,
    mergedEnv: Record<string, string>,
    replaceOptions?: { labels?: Record<string, string> },
  ): Promise<void> {
    const apiName = postgrestContainerName(hash, slug);
    const container = this.docker.getContainer(inspect.Id);
    const env = dockerEnvFromRecord(mergedEnv);
    const wasRunning = inspect.State.Running;
    const privateNet = projectPrivateNetworkName(hash, slug);
    await this.ensureProjectPrivateNetwork(hash, slug);

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
    const memory =
      typeof hc.Memory === "number" && hc.Memory > 0
        ? hc.Memory
        : fluxTenantMemoryLimitBytes();
    const memoryReservation =
      typeof hc.MemoryReservation === "number" && hc.MemoryReservation > 0
        ? hc.MemoryReservation
        : fluxTenantMemoryLimitBytes();
    const nanoCpus =
      typeof hc.NanoCpus === "number" && hc.NanoCpus > 0
        ? hc.NanoCpus
        : fluxTenantCpuNanoCpus();
    const labelMap =
      replaceOptions?.labels ??
      {
        ...stripLegacyUmbrellaMetadataFromLabels(inspect.Config.Labels ?? {}),
        ...fluxContainerMetadataLabels(slug),
      };

    const systemPgrstHostPort = fluxSystemPostgrestHostPublishPort(slug);
    const priorPgrstPortBindings = inspect.HostConfig?.PortBindings;
    const pgrstPortBindings =
      systemPgrstHostPort != null
        ? {
            "3000/tcp": [
              {
                HostIp: FLUX_SYSTEM_HOST_PORT_BIND,
                HostPort: systemPgrstHostPort,
              },
            ],
          }
        : priorPgrstPortBindings;
    const pgrstPortBindingsEffective =
      pgrstPortBindings &&
      typeof pgrstPortBindings === "object" &&
      Object.keys(pgrstPortBindings).length > 0
        ? pgrstPortBindings
        : undefined;

    const created = await this.docker.createContainer({
      name: apiName,
      Image: inspect.Config.Image,
      Labels: labelMap,
      Env: env,
      ExposedPorts: inspect.Config.ExposedPorts ?? { "3000/tcp": {} },
      HostConfig: {
        Memory: memory,
        MemoryReservation: memoryReservation,
        NanoCpus: nanoCpus,
        RestartPolicy: FLUX_TENANT_RESTART_POLICY,
        ...(pgrstPortBindingsEffective
          ? { PortBindings: pgrstPortBindingsEffective }
          : {}),
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [FLUX_NETWORK_NAME]: {},
          [privateNet]: {},
        },
      },
    });

    if (wasRunning) {
      await created.start();
      const newInspect = await created.inspect();
      await this.alignPostgrestToBridgeAndPrivate(newInspect.Id, hash, slug);
    }
  }

  /**
   * Postgres URI using the DB container’s Docker DNS hostname. **Customer** project databases are on
   * the **tenant private** network only, so they are not reachable from arbitrary `flux-network`
   * clients. The **`flux-system`** project is an exception: its Postgres is also on
   * {@link FLUX_NETWORK_NAME} for the control plane (dashboard) `Pool` connection. For other tenants,
   * use `docker exec` / or connect from a container on that tenant’s private network (e.g. PostgREST).
   */
  async getPostgresHostConnectionString(
    projectName: string,
    hash: string,
  ): Promise<string> {
    const { password, containerName } =
      await this.resolveRunningPostgresCredentials(projectName, hash);
    return postgresDockerInternalUri(containerName, password);
  }

  /**
   * Reads `PGRST_JWT_SECRET` from the running PostgREST container’s `inspect().Config.Env` and signs
   * anon / service_role JWTs with that same material — never invents a new secret.
   */
  async getProjectKeys(
    slug: string,
    hash: string,
  ): Promise<{ anonKey: string; serviceRoleKey: string }> {
    const normalized = slugifyProjectName(slug);
    const apiName = postgrestContainerName(hash, normalized);
    let inspect: Awaited<ReturnType<Docker.Container["inspect"]>>;
    try {
      inspect = await this.docker.getContainer(apiName).inspect();
    } catch (err: unknown) {
      if (getHttpStatus(err) === 404) {
        throw new Error(
          `No PostgREST container found for slug "${normalized}" (expected "${apiName}").`,
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
   * Loads Postgres host URI and JWT-backed API keys for a project. Prefer this over pairing
   * {@link getPostgresHostConnectionString} + {@link getProjectKeys} when exposing secrets to a UI,
   * so list endpoints stay non-sensitive.
   */
  async getProjectCredentials(
    projectName: string,
    hash: string,
  ): Promise<FluxProjectCredentials> {
    const slug = slugifyProjectName(projectName);
    const [postgresConnectionString, keys] = await Promise.all([
      this.getPostgresHostConnectionString(slug, hash),
      this.getProjectKeys(slug, hash),
    ]);
    return {
      postgresConnectionString,
      anonKey: keys.anonKey,
      serviceRoleKey: keys.serviceRoleKey,
    };
  }

  /**
   * Streams a plain SQL `pg_dump` from the running tenant Postgres container.
   *
   * Flags:
   * - `schemaOnly` => `-s`
   * - `dataOnly` => `-a`
   * - `clean` => `-c --if-exists`
   * - `publicOnly` => `-n public`
   */
  async getProjectDumpStream(
    slug: string,
    hash: string,
    options?: ProjectDumpOptions,
  ): Promise<Readable> {
    if (options?.schemaOnly === true && options?.dataOnly === true) {
      throw new Error("schemaOnly and dataOnly cannot both be true.");
    }
    const creds = await this.resolveRunningPostgresCredentials(slug, hash);
    const args = ["-U", POSTGRES_USER, "-d", "postgres"] as string[];
    if (options?.schemaOnly === true) args.push("-s");
    if (options?.dataOnly === true) args.push("-a");
    if (options?.clean === true) args.push("-c", "--if-exists");
    if (options?.publicOnly === true) args.push("-n", "public");

    const exec = await this.docker.getContainer(creds.containerId).exec({
      AttachStdout: true,
      AttachStderr: true,
      Cmd: ["pg_dump", ...args],
      Env: [`PGPASSWORD=${creds.password}`],
    });

    const io = await exec.start({
      hijack: true,
      stdin: false,
    });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stderrChunks: Buffer[] = [];
    stderr.on("data", (chunk: Buffer | string | Uint8Array) => {
      stderrChunks.push(
        Buffer.isBuffer(chunk)
          ? chunk
          : typeof chunk === "string"
            ? Buffer.from(chunk, "utf8")
            : Buffer.from(chunk),
      );
    });

    this.docker.modem.demuxStream(
      io as unknown as NodeJS.ReadWriteStream,
      stdout,
      stderr,
    );

    const finalize = async (): Promise<void> => {
      const state = await exec.inspect();
      const code = state.ExitCode ?? 1;
      if (code !== 0) {
        const stderrText = Buffer.concat(stderrChunks).toString("utf8").trim();
        stdout.destroy(
          new Error(
            stderrText.length > 0
              ? `pg_dump failed (${String(code)}): ${stderrText}`
              : `pg_dump failed (${String(code)}).`,
          ),
        );
        return;
      }
      stdout.end();
    };
    io.on("end", () => {
      void finalize();
    });
    io.on("error", (err: Error) => {
      stdout.destroy(err);
    });

    return stdout;
  }

  /**
   * Runs arbitrary SQL against an existing Flux project's Postgres instance.
   *
   * Resolves the running DB container and `POSTGRES_PASSWORD` from Docker inspect, then runs
   * **`psql` via `docker exec`** inside that container (no TCP from the control plane to Postgres;
   * works with remote Docker daemons). After SQL, asks PostgREST to reload its schema cache:
   * `NOTIFY pgrst, 'reload schema'` (handled by PostgREST’s DB listener), a short pause, then
   * **SIGUSR1** on the API container. PostgREST documents SIGUSR1 for schema reload; SIGHUP does
   * not reload the schema cache.
   */
  async executeSql(
    projectName: string,
    sql: string,
    hash: string,
  ): Promise<void> {
    const { slug, containerId, password } =
      await this.resolveRunningPostgresCredentials(projectName, hash);
    await runPsqlSqlInsideContainer(
      this.docker,
      containerId,
      password,
      sql,
      POSTGRES_USER,
    );
    await runPsqlSqlInsideContainer(
      this.docker,
      containerId,
      password,
      `NOTIFY pgrst, 'reload schema';`,
      POSTGRES_USER,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    const apiName = postgrestContainerName(hash, slug);
    try {
      await this.docker.getContainer(apiName).kill({ signal: "SIGUSR1" });
    } catch (err: unknown) {
      const code = getHttpStatus(err);
      if (code === 404 || code === 409) return;
      throw err;
    }
  }

  /**
   * Data-plane SQL push (CLI / control plane): runs the script in a **single** transaction, ends with
   * `NOTIFY pgrst, 'reload schema'`, then `SIGUSR1` on the PostgREST API container. Uses `psql` via
   * `docker exec` to the running tenant DB (works with remote Docker; no host TCP to tenant PG).
   *
   * If `FLUX_PROJECT_PASSWORD_SECRET` or `FLUX_DEV_POSTGRES_PASSWORD` is set, requires the
   * HMAC-derived password to match the container’s `POSTGRES_PASSWORD` (see
   * {@link deriveTenantPostgresPasswordFromSecret}).
   */
  async pushSqlFromCli(
    projectName: string,
    hash: string,
    sql: string,
  ): Promise<void> {
    const creds = await this.resolveRunningPostgresCredentials(projectName, hash);
    const secret =
      process.env.FLUX_PROJECT_PASSWORD_SECRET?.trim() ||
      process.env.FLUX_DEV_POSTGRES_PASSWORD?.trim();
    if (secret) {
      const derived = deriveTenantPostgresPasswordFromSecret(
        secret,
        creds.hash,
        creds.slug,
      );
      if (derived !== creds.password) {
        throw new Error(
          "HMAC password check failed: FLUX_PROJECT_PASSWORD_SECRET or FLUX_DEV_POSTGRES_PASSWORD does not match this project's running Postgres (POSTGRES_PASSWORD).",
        );
      }
    }

    const wrapped = `BEGIN;\n${sql}\nNOTIFY pgrst, 'reload schema';\nCOMMIT;\n`;
    await runPsqlSqlInsideContainer(
      this.docker,
      creds.containerId,
      creds.password,
      wrapped,
      POSTGRES_USER,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    const apiName = postgrestContainerName(hash, creds.slug);
    try {
      await this.docker.getContainer(apiName).kill({ signal: "SIGUSR1" });
    } catch (err: unknown) {
      const code = getHttpStatus(err);
      if (code === 404 || code === 409) return;
      throw err;
    }
  }

  /**
   * Applies a plain SQL dump by uploading a tar via the Docker API and running **`psql -f`** inside
   * the Postgres container (no host TCP to Postgres; works with remote Docker daemons).
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
    hash: string,
    options?: ImportSqlFileOptions,
  ): Promise<ImportSqlFileResult> {
    const emptyResult: ImportSqlFileResult = {
      tablesMoved: 0,
      sequencesMoved: 0,
      viewsMoved: 0,
    };

    const { slug: normalizedSlug, containerId, password } =
      await this.resolveRunningPostgresCredentials(slug, hash);

    const materialized = await materializePreparedSqlFile(
      filePath,
      options,
      () => queryPostgresMajorVersion(this.docker, containerId, password),
    );

    try {
      await runPsqlHostFileInsideContainer(
        this.docker,
        containerId,
        password,
        materialized.path,
        POSTGRES_USER,
      );

      let moveResult = emptyResult;
      if (options?.moveFromPublic === true) {
        moveResult = await runMovePublicToApiWithDockerExec(
          this.docker,
          containerId,
          password,
          POSTGRES_USER,
        );
      }

      await runPsqlSqlInsideContainer(
        this.docker,
        containerId,
        password,
        API_SCHEMA_PRIVILEGES_SQL,
        POSTGRES_USER,
      );
      if (options?.disableRowLevelSecurityInApi === true) {
        await runPsqlSqlInsideContainer(
          this.docker,
          containerId,
          password,
          DISABLE_ROW_LEVEL_SECURITY_FOR_RLS_ENABLED_API_TABLES_SQL,
          POSTGRES_USER,
        );
      }

      await runPsqlSqlInsideContainer(
        this.docker,
        containerId,
        password,
        `NOTIFY pgrst, 'reload schema';`,
        POSTGRES_USER,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      const apiName = postgrestContainerName(hash, normalizedSlug);
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
  async resetTenantDatabaseForImport(
    projectName: string,
    hash: string,
  ): Promise<void> {
    const { containerId, password } =
      await this.resolveRunningPostgresCredentials(projectName, hash);
    const resetSql = `
DROP SCHEMA IF EXISTS auth CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
ALTER SCHEMA public OWNER TO postgres;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
COMMENT ON SCHEMA public IS 'standard public schema';
`.trim();
    await runPsqlSqlInsideContainer(
      this.docker,
      containerId,
      password,
      resetSql,
      POSTGRES_USER,
    );
    await runPsqlSqlInsideContainer(
      this.docker,
      containerId,
      password,
      BOOTSTRAP_SQL,
      POSTGRES_USER,
    );
  }

  private async resolveRunningPostgresCredentials(
    projectName: string,
    hash: string,
  ): Promise<{
    slug: string;
    hash: string;
    containerId: string;
    containerName: string;
    password: string;
  }> {
    const slug = slugifyProjectName(projectName);
    const containerName = postgresContainerName(hash, slug);

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

    const password = inspect.Config.Env?.find((e) =>
      e.startsWith("POSTGRES_PASSWORD="),
    )?.slice("POSTGRES_PASSWORD=".length);
    if (!password) {
      throw new Error(
        `Could not retrieve POSTGRES_PASSWORD from container "${containerName}".`,
      );
    }

    return { slug, hash, containerId: inspect.Id, containerName, password };
  }

  /**
   * POSTGRES_PASSWORD from the running tenant Postgres container (must be running).
   * For HMAC-only dev flows without a live container, use
   * {@link deriveTenantPostgresPasswordFromSecret} instead.
   */
  async getPostgresSuperuserPassword(
    projectName: string,
    hash: string,
  ): Promise<string> {
    const { password } = await this.resolveRunningPostgresCredentials(
      projectName,
      hash,
    );
    return password;
  }

  /**
   * Lists Flux tenant projects by scanning Docker for `flux-*-db` / `flux-*-api` containers.
   *
   * Returns only **slug**, **status**, and **apiUrl** — never Postgres passwords, connection URIs,
   * or JWT keys. Use {@link getProjectCredentials} when those values are required.
   */
  async listProjects(): Promise<FluxProjectSummary[]> {
    const containers = await this.docker.listContainers({ all: true });
    const byStack = new Map<
      string,
      { hash: string; slug: string; dbState?: string; apiState?: string }
    >();

    for (const c of containers) {
      const raw = c.Names?.[0]?.replace(/^\//, "") ?? "";
      const m = raw.match(FLUX_TENANT_CONTAINER);
      if (!m?.[1] || !m[2] || !m[3]) continue;
      const hash = m[1];
      const slug = m[2];
      const kind = m[3] as "db" | "api";
      const stackKey = `${hash}\n${slug}`;
      const cur = byStack.get(stackKey) ?? { hash, slug };
      if (kind === "db") cur.dbState = c.State;
      else cur.apiState = c.State;
      byStack.set(stackKey, cur);
    }

    const rows: FluxProjectSummary[] = [];
    for (const e of byStack.values()) {
      const db: ContainerLifecycleState =
        e.dbState === undefined
          ? "missing"
          : e.dbState === "running"
            ? "running"
            : "stopped";
      const api: ContainerLifecycleState =
        e.apiState === undefined
          ? "missing"
          : e.apiState === "running"
            ? "running"
            : "stopped";
      const status = fluxTenantStatusFromContainerPair(db, api);

      rows.push({
        slug: e.slug,
        hash: e.hash,
        status,
        apiUrl: fluxApiUrlForSlug(e.slug, e.hash, false),
      });
    }

    return rows.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /**
   * Resolves status for specific slugs by **direct container inspect** (two Engine calls per slug),
   * without scanning every container on the host. Intended for **catalog-driven** UIs (e.g. flux-system
   * `projects` rows).
   */
  async getProjectSummariesForSlugs(
    refs: FluxProjectSlugRef[],
    options?: { isProduction?: boolean },
  ): Promise<FluxProjectSummary[]> {
    if (refs.length === 0) return [];
    const seen = new Set<string>();
    const unique = refs.filter((r) => {
      const slug = slugifyProjectName(r.slug);
      const k = `${slug}\0${r.hash}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const isProduction = options?.isProduction === true;
    const rows = await Promise.all(
      unique.map(async ({ slug: rawSlug, hash }) => {
        const slug = slugifyProjectName(rawSlug);
        const dbName = postgresContainerName(hash, slug);
        const apiName = postgrestContainerName(hash, slug);
        const [db, api] = await Promise.all([
          inspectContainerLifecycleState(this.docker, dbName),
          inspectContainerLifecycleState(this.docker, apiName),
        ]);
        return {
          slug,
          hash,
          status: fluxTenantStatusFromContainerPair(db, api),
          apiUrl: fluxApiUrlForSlug(slug, hash, isProduction),
        };
      }),
    );
    return rows.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /**
   * Single enrichment path for **catalog-owned** projects (dashboard session, CLI API key):
   * loads `{ slug, hash }` for the user from the host DB via {@link loadSlugRefsForUser}, then
   * delegates to {@link getProjectSummariesForSlugs} (Docker inspect + {@link fluxApiUrlForSlug}).
   * Keeps `apiUrl` / `status` rules aligned across Web and CLI when subdomain or inspect logic changes.
   */
  async getProjectSummariesForUser(
    userId: string,
    options: {
      loadSlugRefsForUser: (
        userId: string,
      ) => Promise<readonly FluxProjectSlugRef[]>;
      isProduction?: boolean;
    },
  ): Promise<FluxProjectSummary[]> {
    const refs = await options.loadSlugRefsForUser(userId);
    const isProduction = options.isProduction === true;
    return this.getProjectSummariesForSlugs(
      [...refs],
      isProduction ? { isProduction: true } : {},
    );
  }

  /**
   * Lists catalog projects with `last_accessed_at` and flags rows older than `maxAgeDays`
   * (for reporting; does not stop containers).
   */
  /**
   * Looks up the per-project `hash` from the flux-system catalog so slug-only CLI commands
   * (e.g. `flux push`, `flux keys`) can locate the right Docker stack without requiring the
   * caller to know the hash. Matches on `slug` alone when `ownerKey` is nullish, or on
   * `(slug, "userId")` when provided. Returns `null` when no row matches.
   *
   * Requires the `flux-system` stack to be running locally (same Docker engine as the tenant
   * containers); throws a helpful error otherwise so CLI callers can fall back to a `--hash`
   * flag.
   */
  async lookupProjectHashBySlug(
    slug: string,
    ownerKey?: string,
  ): Promise<string | null> {
    const normalized = slugifyProjectName(slug);
    const { containerId, password } = await this.resolveRunningPostgresCredentials(
      "flux-system",
      FLUX_SYSTEM_HASH,
    );
    const slugLit = `'${normalized.replace(/'/g, "''")}'`;
    const where = ownerKey
      ? `slug = ${slugLit} AND "userId" = '${ownerKey.replace(/'/g, "''")}'`
      : `slug = ${slugLit}`;
    const rows = (await queryPsqlJsonRows(
      this.docker,
      containerId,
      password,
      `SELECT hash FROM projects WHERE ${where} LIMIT 1`,
      POSTGRES_USER,
    )) as Array<{ hash: string }>;
    return rows[0]?.hash ?? null;
  }

  async stopInactiveProjects(
    maxAgeDays: number,
  ): Promise<FluxSystemProjectActivity[]> {
    const { containerId, password } = await this.resolveRunningPostgresCredentials(
      "flux-system",
      FLUX_SYSTEM_HASH,
    );
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - maxAgeMs;

    const rows = await queryPsqlJsonRows(
      this.docker,
      containerId,
      password,
      `SELECT id::text AS id, name, slug, last_accessed_at
       FROM projects
       ORDER BY slug`,
      POSTGRES_USER,
    );
    return (
      rows as Array<{
        id: string;
        name: string;
        slug: string;
        last_accessed_at: string;
      }>
    ).map((row) => {
      const lastAccessedAt = new Date(row.last_accessed_at);
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        lastAccessedAt,
        inactiveByPolicy: lastAccessedAt.getTime() < cutoff,
      };
    });
  }

  /**
   * **Flux reaper:** stops tenant Docker stacks whose catalog `last_accessed_at` is older than
   * `maxIdleHours`. Skips **`flux-system`**. Idempotent for already-stopped containers.
   */
  async reapIdleProjects(maxIdleHours: number): Promise<{
    stopped: string[];
    errors: Array<{ slug: string; message: string }>;
  }> {
    if (!Number.isFinite(maxIdleHours) || maxIdleHours <= 0) {
      throw new Error("maxIdleHours must be a positive number.");
    }
    const { containerId, password } = await this.resolveRunningPostgresCredentials(
      "flux-system",
      FLUX_SYSTEM_HASH,
    );
    const cutoff = new Date(Date.now() - maxIdleHours * 60 * 60 * 1000);
    const cutoffIso = cutoff.toISOString();

    const rows = await queryPsqlJsonRows(
      this.docker,
      containerId,
      password,
      `SELECT slug, hash FROM projects
       WHERE slug <> 'flux-system' AND last_accessed_at < '${cutoffIso}'::timestamptz
       ORDER BY slug`,
      POSTGRES_USER,
    );
    const entries = rows as { slug: string; hash: string }[];

    const stopped: string[] = [];
    const errors: Array<{ slug: string; message: string }> = [];
    for (const row of entries) {
      try {
        await this.stopProject(row.slug, row.hash);
        stopped.push(row.slug);
      } catch (err: unknown) {
        errors.push({
          slug: row.slug,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { stopped, errors };
  }

  /**
   * Stops the Postgres and PostgREST containers for a project (API first, then DB).
   */
  async stopProject(name: string, hash: string): Promise<void> {
    const slug = slugifyProjectName(name);
    const apiName = postgrestContainerName(hash, slug);
    const dbName = postgresContainerName(hash, slug);
    await this.stopContainerOrThrow(apiName);
    await this.stopContainerOrThrow(dbName);
  }

  /**
   * Start stopped tenant containers: Postgres first, brief wait, then PostgREST.
   * Used by the control plane so the DB accepts connections before the API starts.
   */
  async startProjectInfrastructure(slug: string, hash: string): Promise<void> {
    const normalized = slugifyProjectName(slug);
    const dbName = postgresContainerName(hash, normalized);
    const apiName = postgrestContainerName(hash, normalized);
    await this.startContainerOrThrow(dbName);
    await sleep(2000);
    await this.startContainerOrThrow(apiName);
  }

  /**
   * Starts the Postgres and PostgREST containers (DB first, then API after a short delay).
   */
  async startProject(name: string, hash: string): Promise<void> {
    const slug = slugifyProjectName(name);
    await this.startProjectInfrastructure(slug, hash);
  }

  /**
   * Stops and removes both tenant containers and deletes the Postgres data volume.
   * Irreversible: all database files for the project are destroyed. Delegates to
   * {@link deleteProjectInfrastructure} (atomic: data volume must be gone afterward).
   */
  async nukeProject(
    name: string,
    options: NukeProjectOptions,
  ): Promise<void> {
    await this.deleteProjectInfrastructure(name, options.hash);
  }

  /**
   * **Atomic nuke protocol:** remove PostgREST + Postgres containers, delete named volume
   * `flux-{hash}-{slug}-db-data` (or confirm it was already missing), and remove the per-tenant
   * bridge. Resolves only after verifying the data volume is absent from the Engine.
   */
  async deleteProjectInfrastructure(
    slug: string,
    hash: string,
  ): Promise<DeleteProjectInfrastructureResult> {
    const normalized = slugifyProjectName(slug);
    const apiName = postgrestContainerName(hash, normalized);
    const dbName = postgresContainerName(hash, normalized);
    const vol = tenantVolumeName(hash, normalized);
    const privateNet = projectPrivateNetworkName(hash, normalized);
    await removeApiPgAndVolumeForProvision(
      this.docker,
      apiName,
      dbName,
      vol,
      privateNet,
    );
    try {
      await this.docker.getVolume(vol).inspect();
    } catch (e: unknown) {
      if (getHttpStatus(e) === 404) {
        return {
          ok: true,
          removed: {
            apiContainer: apiName,
            dbContainer: dbName,
            volume: vol,
            privateNetwork: privateNet,
          },
        };
      }
      throw e;
    }
    throw new Error(
      `Data volume "${vol}" still exists after deleteProjectInfrastructure; not returning success for atomic nuke.`,
    );
  }

  /**
   * Ghost-rollback helper: same as {@link deleteProjectInfrastructure} (API + DB + volume + net).
   * For a fresh stack whose catalog insert failed. No `acknowledgeDataLoss` — caller-only API.
   */
  async nukeContainersOnly(slug: string, hash: string): Promise<void> {
    await this.deleteProjectInfrastructure(slug, hash);
  }

  /**
   * Recent Docker logs for the tenant PostgREST (`api`) or Postgres (`db`) container.
   * Fetches stdout and stderr in separate Engine calls so responses are plain text (no stream demux).
   */
  async getTenantContainerLogs(
    slug: string,
    hash: string,
    kind: "api" | "db",
    options?: { tail?: number },
  ): Promise<string> {
    const normalized = slugifyProjectName(slug);
    const containerName =
      kind === "api"
        ? postgrestContainerName(hash, normalized)
        : postgresContainerName(hash, normalized);
    const tail = options?.tail ?? 300;
    const container = this.docker.getContainer(containerName);

    try {
      await container.inspect();
    } catch (e: unknown) {
      if (getHttpStatus(e) === 404) {
        return `Container "${containerName}" does not exist on this Docker host.`;
      }
      throw e;
    }

    const readLog = async (stdout: boolean, stderr: boolean): Promise<string> => {
      const raw = await container.logs({
        stdout,
        stderr,
        tail,
        timestamps: true,
      });
      if (Buffer.isBuffer(raw)) {
        return raw.toString("utf8").trimEnd();
      }
      const chunks: Buffer[] = [];
      for await (const chunk of raw as AsyncIterable<Uint8Array | Buffer>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString("utf8").trimEnd();
    };

    const out = await readLog(true, false);
    const errText = await readLog(false, true);

    const parts: string[] = [];
    if (out.length > 0) parts.push(out);
    if (errText.length > 0) parts.push(`[stderr]\n${errText}`);
    if (parts.length === 0) return "(no log lines yet)";
    return parts.join("\n\n");
  }

  /**
   * Live log stream for the tenant PostgREST (`api`) or Postgres (`db`) container. Multiplexed
   * stdout/stderr from the Engine is demuxed into a single UTF-8 byte stream (no frame headers).
   * Pass `signal` to cancel the follow request (e.g. when the HTTP client disconnects).
   */
  async getContainerLogs(
    slug: string,
    hash: string,
    service: "api" | "db",
    options?: { tail?: number; signal?: AbortSignal },
  ): Promise<ReadableStream<Uint8Array>> {
    const normalized = slugifyProjectName(slug);
    const containerName =
      service === "api"
        ? postgrestContainerName(hash, normalized)
        : postgresContainerName(hash, normalized);
    const c = this.docker.getContainer(containerName);
    try {
      await c.inspect();
    } catch (e: unknown) {
      if (getHttpStatus(e) === 404) {
        throw new Error(
          `Container "${containerName}" does not exist on this Docker host.`,
        );
      }
      throw e;
    }
    const logOpts = {
      follow: true as const,
      stdout: true,
      stderr: true,
      timestamps: true,
      tail: options?.tail ?? 200,
      ...(options?.signal ? { abortSignal: options.signal } : {}),
    };
    const raw = (await c.logs(logOpts)) as unknown;
    if (Buffer.isBuffer(raw)) {
      const body = demuxDockerLogBufferIfMultiplexed(raw);
      return new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(new Uint8Array(body));
          ctrl.close();
        },
      });
    }
    let nodeIn: Readable;
    if (
      raw &&
      typeof raw === "object" &&
      "getReader" in raw &&
      typeof (raw as { getReader?: () => unknown }).getReader === "function"
    ) {
      nodeIn = Readable.fromWeb(raw as import("node:stream/web").ReadableStream);
    } else if (raw instanceof Readable) {
      nodeIn = raw;
    } else {
      throw new Error("Unexpected value from container.logs (expected Buffer or stream).");
    }
    const demuxed = demuxDockerLogStream(nodeIn, {
      ...(options?.signal ? { signal: options.signal } : {}),
    });
    return Readable.toWeb(demuxed) as ReadableStream<Uint8Array>;
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
   * Isolated per-tenant bridge used only for Postgres + PostgREST (internal: no default route to
   * the public internet; tenant DB is not on {@link FLUX_NETWORK_NAME}).
   */
  private async ensureProjectPrivateNetwork(
    hash: string,
    slug: string,
    onStatus?: (message: string) => void,
  ): Promise<string> {
    const name = projectPrivateNetworkName(hash, slug);
    onStatus?.(`Checking Docker network ${name}…`);
    const listed = await this.docker.listNetworks({
      filters: { name: [name] },
    });
    if (!listed.some((n) => n.Name === name)) {
      try {
        await this.docker.createNetwork({
          Name: name,
          Driver: "bridge",
          Internal: true,
          CheckDuplicate: true,
        });
        onStatus?.(`Created internal network ${name}.`);
      } catch (err: unknown) {
        if (getHttpStatus(err) === 409) {
          onStatus?.(`Network ${name} already exists (race or stale state).`);
        } else {
          throw err;
        }
      }
    } else {
      onStatus?.(`Network ${name} already exists.`);
    }
    return name;
  }

  /**
   * Removes the tenant’s private `flux-${hash}-${slug}-net` if it still exists, disconnecting
   * endpoints first. Idempotent. Call after nuke, before (re)provision, so repair does not hit
   * duplicate-network errors.
   */
  async removeTenantPrivateNetworkAllowMissing(
    slug: string,
    hash: string,
  ): Promise<void> {
    const normalized = slugifyProjectName(slug);
    const netName = projectPrivateNetworkName(hash, normalized);
    await removeDockerNetworkByNameAllowMissing(this.docker, netName);
  }

  /**
   * Isolates tenant Postgres on the private network only. The platform `flux-system` DB is an
   * exception: it stays on the private network **and** {@link FLUX_NETWORK_NAME} so the dashboard
   * (or other bridge-only services) can open `Pool` / Drizzle to `getPostgresHostConnectionString`.
   */
  private async alignPostgresToPrivateOnlyNetwork(
    containerId: string,
    hash: string,
    slug: string,
    onStatus?: (message: string) => void,
  ): Promise<void> {
    const privateName = projectPrivateNetworkName(hash, slug);
    const platform = isPlatformSystemStackSlug(slug);
    await this.ensureProjectPrivateNetwork(hash, slug, onStatus);
    const before = await this.docker.getContainer(containerId).inspect();
    const nets = before.NetworkSettings?.Networks ?? {};
    if (!nets[privateName]) {
      onStatus?.(`Attaching Postgres to ${privateName}…`);
      try {
        await this.docker
          .getNetwork(privateName)
          .connect({ Container: containerId });
      } catch (err: unknown) {
        if (getHttpStatus(err) !== 409) throw err;
      }
    }
    if (platform) {
      onStatus?.(
        `Ensuring platform Postgres stays on ${FLUX_NETWORK_NAME} (control plane access)…`,
      );
      await this.ensureContainerAttachedToFluxNetwork(containerId);
      return;
    }
    const after = await this.docker.getContainer(containerId).inspect();
    const hasFlux =
      (after.NetworkSettings?.Networks ?? {})[FLUX_NETWORK_NAME] != null;
    if (hasFlux) {
      onStatus?.(`Detaching Postgres from ${FLUX_NETWORK_NAME}…`);
      try {
        await this.docker.getNetwork(FLUX_NETWORK_NAME).disconnect({
          Container: containerId,
          Force: true,
        });
      } catch (err: unknown) {
        if (getHttpStatus(err) !== 404) throw err;
      }
    }
  }

  /**
   * PostgREST must be on the Traefik bridge and the private network so the gateway and `PGRST_DB_URI`
   * can each reach their peer.
   */
  private async alignPostgrestToBridgeAndPrivate(
    containerId: string,
    hash: string,
    slug: string,
    onStatus?: (message: string) => void,
  ): Promise<void> {
    const privateName = projectPrivateNetworkName(hash, slug);
    await this.ensureProjectPrivateNetwork(hash, slug, onStatus);
    const before = await this.docker.getContainer(containerId).inspect();
    const nets = before.NetworkSettings?.Networks ?? {};
    if (!nets[privateName]) {
      onStatus?.(`Attaching PostgREST to ${privateName}…`);
      try {
        await this.docker
          .getNetwork(privateName)
          .connect({ Container: containerId });
      } catch (err: unknown) {
        if (getHttpStatus(err) !== 409) throw err;
      }
    }
    await this.ensureContainerAttachedToFluxNetwork(containerId);
  }

  /** Best-effort: sync memory / CPU / restart policy to current tenant defaults (idempotent for new containers). */
  private async applyTenantResourceLimits(
    containerId: string,
    onStatus?: (message: string) => void,
  ): Promise<void> {
    try {
      await this.docker.getContainer(containerId).update({
        ...tenantStackHostMemoryConfig(),
        NanoCpus: fluxTenantCpuNanoCpus(),
        RestartPolicy: FLUX_TENANT_RESTART_POLICY,
      });
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      onStatus?.(
        `Note: could not apply resource or restart policy update to ${containerId.slice(0, 12)}: ${detail}`,
      );
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
   * Verifies a container named {@link FLUX_GATEWAY_CONTAINER_NAME} is **running** on the Engine.
   * The Traefik gateway is expected to be started by external tooling (e.g. a standalone Compose
   * stack); this method does not create, pull, or start that container.
   */
  private async ensureFluxGateway(
    onStatus?: (message: string) => void,
  ): Promise<void> {
    const name = FLUX_GATEWAY_CONTAINER_NAME;
    onStatus?.(`Checking Traefik gateway ${name}…`);
    const inspect = await fluxInspectContainerOrNull(this.docker, name);
    if (inspect?.State.Running) {
      onStatus?.(`Gateway ${name} is running.`);
      return;
    }
    const text =
      "Infrastructure Gateway is missing (no running container named flux-gateway; manage Traefik with external compose on flux-network if needed).";
    if (onStatus) onStatus(`⚠ ${text}`);
    else console.warn(`⚠ ${text}`);
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
  const docker = createFluxDocker();

  console.log(`▸ Targeting Docker Engine: ${formatDockerEngineTarget(docker)}`);
  console.log("🔄 Attempting to connect to Docker Engine...");

  try {
    await assertFluxDockerEngineReachableOrThrow(docker);
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

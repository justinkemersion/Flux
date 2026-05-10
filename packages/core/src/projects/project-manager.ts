import { createHmac, randomBytes } from "node:crypto";
import { freemem, loadavg, totalmem } from "node:os";
import { PassThrough, Readable } from "node:stream";
import Docker from "dockerode";
import jwt from "jsonwebtoken";

import {
  buildApiSchemaPrivilegesSql,
  buildDisableRowLevelSecurityForSchemaSql,
} from "../api-schema-privileges.ts";
import {
  assertFluxApiSchemaIdentifier,
  LEGACY_FLUX_API_SCHEMA,
} from "../api-schema-strategy.ts";
import {
  materializePreparedSqlFile,
  queryPostgresMajorVersion,
  type ImportSqlFileOptions,
} from "../import-dump.ts";
import {
  queryPsqlJsonRows,
  runPsqlHostFileInsideContainer,
  runPsqlSqlInsideContainer,
  waitPostgresReadyInsideContainer,
} from "../postgres-internal-exec.ts";
import {
  demuxDockerLogBufferIfMultiplexed,
  demuxDockerLogStream,
} from "../docker-log-stream.ts";
import {
  runMovePublicSchemaToTargetWithDockerExec,
  runMovePublicToApiWithDockerExec,
} from "../schema-move-public-to-api.ts";
import {
  FLUX_PROJECT_HASH_HEX_LEN,
  FLUX_SYSTEM_HASH,
  generateProjectHash,
} from "../tenant-suffix.ts";
import {
  type FluxProjectEnvEntry,
  type FluxProjectSummary,
  type ImportSqlFileResult,
  fluxTenantStatusFromContainerPair,
  slugifyProjectName,
} from "../standalone.ts";
import {
  fluxApiHttpsForTenantUrls,
  fluxApiUrlForSlug,
  fluxTenantDomain,
  fluxTenantV1LegacyDottedHostname,
  fluxTenantV2SharedHostname,
} from "../tenant-catalog-urls.ts";

import {
  FLUX_GATEWAY_CONTAINER_NAME,
  FLUX_MANAGED_LABEL,
  FLUX_MANAGED_VALUE,
  FLUX_NETWORK_NAME,
  FLUX_PROJECT_SLUG_LABEL,
  FLUX_PURPOSE_CONTROL_PLANE,
  FLUX_PURPOSE_LABEL,
  FLUX_PURPOSE_TENANT,
  POSTGRES_USER,
} from "../docker/docker-constants.ts";
import { BOOTSTRAP_SQL, buildBootstrapSql, pgrstDbSchemasEnvValue } from "../database/bootstrap-sql.ts";
import { deriveTenantPostgresPasswordFromSecret } from "../database/tenant-postgres-password.ts";
import { isFluxSensitiveEnvKey } from "../runtime/sensitive-env.ts";
import {
  FLUX_TENANT_RESTART_POLICY,
  fluxTenantCpuNanoCpus,
  fluxTenantMemoryLimitBytes,
  tenantStackHostMemoryConfig,
} from "../docker/docker-resources.ts";
import {
  fluxSystemPostgresHostPublishPort,
  fluxSystemPostgrestHostPublishPort,
  FLUX_SYSTEM_HOST_PORT_BIND,
} from "../docker/system-publish-ports.ts";
import {
  fluxTenantStackBaseId,
  isPlatformSystemStackSlug,
  postgresContainerName,
  postgrestContainerName,
  projectPrivateNetworkName,
  tenantVolumeName,
} from "../docker/docker-names.ts";
import {
  FLUX_CORS_EXTRA_ORIGINS_LABEL,
  dockerLabelsSatisfy,
  fluxContainerMetadataLabels,
  logTraefikLabelsForTenant,
  mergedPostgrestTraefikDockerLabels,
  parseAllowedOriginsList,
  postgrestTraefikDockerLabels,
  stripAllTraefikLabelsPreservingFluxExtras,
  stripLegacyUmbrellaMetadataFromLabels,
  traefikLabelsExactlyMatch,
} from "../traefik/traefik-labels.ts";
import {
  assertFluxDockerEngineReachableOrThrow,
  createFluxDocker,
  formatDockerEngineTarget,
  resolveProjectManagerDocker,
  type ProjectManagerConnectOptions,
} from "../docker/docker-client.ts";
import { createFluxCoreContext, type FluxCoreContext } from "../runtime/context.ts";
import {
  getDockerEngineHttpStatus,
  removeApiPgAndVolumeForProvision,
  removeDockerNetworkByNameAllowMissing,
} from "./delete-docker-tenant-stack.ts";

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
    if (getDockerEngineHttpStatus(err) === 404) return null;
    throw err;
  }
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
    if (getDockerEngineHttpStatus(err) === 404) return "missing";
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
    if (getDockerEngineHttpStatus(err) === 409) return;
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
  /**
   * Primary PostgREST schema (`api` or mirrored `t_<shortId>_api`). Defaults to `api`.
   * Forced to `api` for the `flux-system` stack regardless of this option.
   */
  apiSchemaName?: string;
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
  private readonly ctx: FluxCoreContext;

  constructor(docker?: Docker);
  constructor(options?: ProjectManagerConnectOptions);
  constructor(arg?: Docker | ProjectManagerConnectOptions) {
    this.ctx = createFluxCoreContext(resolveProjectManagerDocker(arg));
  }

  /**
   * Verifies the configured Engine responds to **`ping`** when strict remote mode applies
   * ({@link dockerEngineRequiresStrictReachability}); no-op for local-socket-only setups.
   */
  async assertDockerEngineReachableOrThrow(): Promise<void> {
    await assertFluxDockerEngineReachableOrThrow(this.ctx.docker);
  }

  /**
   * **Control room** telemetry: `docker info` for container count, `os` for RAM % and 1m load.
   */
  async getNodeStats(): Promise<FluxNodeStats> {
    const info = (await this.ctx.docker.info()) as { Containers?: number };
    const containerCount: number =
      typeof info.Containers === "number" && info.Containers >= 0
        ? info.Containers
        : (await this.ctx.docker.listContainers({ all: true })).length;
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
    const targetBody = `Targeting Docker Engine: ${formatDockerEngineTarget(this.ctx.docker)}`;
    if (log) {
      log(targetBody);
    } else {
      console.log(`▸ ${targetBody}`);
    }
    await assertFluxDockerEngineReachableOrThrow(this.ctx.docker);
    await this.ensureFluxNetwork(log);
    await this.ensureFluxGateway(log);
    const slug = slugifyProjectName(name);
    let apiSchemaName = options?.apiSchemaName?.trim() || LEGACY_FLUX_API_SCHEMA;
    if (isPlatformSystemStackSlug(slug)) {
      apiSchemaName = LEGACY_FLUX_API_SCHEMA;
    } else {
      assertFluxApiSchemaIdentifier(apiSchemaName);
    }
    const tenantBootstrapSql = buildBootstrapSql(apiSchemaName);
    const pgrstSchemasValue = pgrstDbSchemasEnvValue(apiSchemaName);
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
        this.ctx.docker,
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
    await ensureNamedVolume(this.ctx.docker, volumeName);
    log?.("Ensuring container images…");
    await ensureImage(this.ctx.docker, this.ctx.images.postgres, log);
    await ensureImage(this.ctx.docker, this.ctx.images.postgrest, log);

    let pgContainer: Docker.Container;
    const pgExisting = await fluxInspectContainerOrNull(
      this.ctx.docker,
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
        pgContainer = this.ctx.docker.getContainer(pgContainerName);
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
      pgContainer = this.ctx.docker.getContainer(pgContainerName);
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
      this.ctx.docker,
      pgInspect.Id,
      log
        ? { onStatus: log, maxAttempts: 80 }
        : { maxAttempts: 80 },
    );
    await runPsqlSqlInsideContainer(
      this.ctx.docker,
      pgInspect.Id,
      postgresPassword,
      tenantBootstrapSql,
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
      this.ctx.docker,
      apiContainerName,
    );
    if (apiExisting) {
      log?.(
        `PostgREST container "${apiContainerName}" already exists; resuming (start if stopped, reuse JWT)…`,
      );
      apiContainer = this.ctx.docker.getContainer(apiContainerName);
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
        apiContainer = this.ctx.docker.getContainer(apiContainerName);
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
        apiContainer = this.ctx.docker.getContainer(apiContainerName);
      }
    } else {
      log?.(`Creating PostgREST container ${apiContainerName}…`);
      const systemPgrstHostPort = fluxSystemPostgrestHostPublishPort(slug);
      apiContainer = await this.ctx.docker.createContainer({
        name: apiContainerName,
        Image: this.ctx.images.postgrest,
        Labels: traefikLabels,
        Env: [
          `PGRST_DB_URI=${dbUri}`,
          `PGRST_JWT_SECRET=${jwtSecret}`,
          `PGRST_DB_SCHEMAS=${pgrstSchemasValue}`,
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
      return await this.ctx.docker.getContainer(apiName).inspect();
    } catch (err: unknown) {
      if (getDockerEngineHttpStatus(err) === 404) {
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
      return await this.ctx.docker.createContainer({
        name: opts.name,
        Image: this.ctx.images.postgres,
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
    return await this.ctx.docker.createContainer({
      name: opts.name,
      Image: this.ctx.images.postgres,
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
    const container = this.ctx.docker.getContainer(inspect.Id);
    const env = dockerEnvFromRecord(mergedEnv);
    const wasRunning = inspect.State.Running;
    const privateNet = projectPrivateNetworkName(hash, slug);
    await this.ensureProjectPrivateNetwork(hash, slug);

    if (wasRunning) {
      try {
        await container.stop({ t: 10 });
      } catch (err: unknown) {
        const code = getDockerEngineHttpStatus(err);
        if (code !== 304 && code !== 404) throw err;
      }
    }

    try {
      await container.remove();
    } catch (err: unknown) {
      if (getDockerEngineHttpStatus(err) !== 404) throw err;
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

    const created = await this.ctx.docker.createContainer({
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
      inspect = await this.ctx.docker.getContainer(apiName).inspect();
    } catch (err: unknown) {
      if (getDockerEngineHttpStatus(err) === 404) {
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

    const exec = await this.ctx.docker.getContainer(creds.containerId).exec({
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

    this.ctx.docker.modem.demuxStream(
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
   * Streams a PostgreSQL custom-format backup (`pg_dump -Fc`) from a running tenant Postgres.
   * Intended for restoreable backup artifacts (compressed/custom format for `pg_restore`).
   */
  async getProjectCustomBackupStream(
    slug: string,
    hash: string,
  ): Promise<Readable> {
    const creds = await this.resolveRunningPostgresCredentials(slug, hash);
    const exec = await this.ctx.docker.getContainer(creds.containerId).exec({
      AttachStdout: true,
      AttachStderr: true,
      Cmd: [
        "pg_dump",
        "-U",
        POSTGRES_USER,
        "-d",
        "postgres",
        "-Fc",
        "--no-owner",
        "--no-acl",
      ],
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
    this.ctx.docker.modem.demuxStream(
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
              ? `pg_dump -Fc failed (${String(code)}): ${stderrText}`
              : `pg_dump -Fc failed (${String(code)}).`,
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
      this.ctx.docker,
      containerId,
      password,
      sql,
      POSTGRES_USER,
    );
    await runPsqlSqlInsideContainer(
      this.ctx.docker,
      containerId,
      password,
      `NOTIFY pgrst, 'reload schema';`,
      POSTGRES_USER,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    const apiName = postgrestContainerName(hash, slug);
    try {
      await this.ctx.docker.getContainer(apiName).kill({ signal: "SIGUSR1" });
    } catch (err: unknown) {
      const code = getDockerEngineHttpStatus(err);
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
    options?: { searchPathSchemas?: readonly string[] },
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

    let pathList = "api, public";
    if (options?.searchPathSchemas && options.searchPathSchemas.length > 0) {
      for (const s of options.searchPathSchemas) {
        assertFluxApiSchemaIdentifier(s);
      }
      pathList = options.searchPathSchemas.join(", ");
    }
    const wrapped = `BEGIN;\nSET LOCAL search_path TO ${pathList};\n${sql}\nNOTIFY pgrst, 'reload schema';\nCOMMIT;\n`;
    await runPsqlSqlInsideContainer(
      this.ctx.docker,
      creds.containerId,
      creds.password,
      wrapped,
      POSTGRES_USER,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    const apiName = postgrestContainerName(hash, creds.slug);
    try {
      await this.ctx.docker.getContainer(apiName).kill({ signal: "SIGUSR1" });
    } catch (err: unknown) {
      const code = getDockerEngineHttpStatus(err);
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

    const apiSchema = options?.apiSchemaName?.trim() || LEGACY_FLUX_API_SCHEMA;
    assertFluxApiSchemaIdentifier(apiSchema);

    const { slug: normalizedSlug, containerId, password } =
      await this.resolveRunningPostgresCredentials(slug, hash);

    const materialized = await materializePreparedSqlFile(
      filePath,
      options,
      () => queryPostgresMajorVersion(this.ctx.docker, containerId, password),
    );

    try {
      await runPsqlHostFileInsideContainer(
        this.ctx.docker,
        containerId,
        password,
        materialized.path,
        POSTGRES_USER,
      );

      let moveResult = emptyResult;
      if (options?.moveFromPublic === true) {
        moveResult = await runMovePublicSchemaToTargetWithDockerExec(
          this.ctx.docker,
          containerId,
          password,
          POSTGRES_USER,
          apiSchema,
        );
      }

      await runPsqlSqlInsideContainer(
        this.ctx.docker,
        containerId,
        password,
        buildApiSchemaPrivilegesSql(apiSchema),
        POSTGRES_USER,
      );
      if (options?.disableRowLevelSecurityInApi === true) {
        await runPsqlSqlInsideContainer(
          this.ctx.docker,
          containerId,
          password,
          buildDisableRowLevelSecurityForSchemaSql(apiSchema),
          POSTGRES_USER,
        );
      }

      await runPsqlSqlInsideContainer(
        this.ctx.docker,
        containerId,
        password,
        `NOTIFY pgrst, 'reload schema';`,
        POSTGRES_USER,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      const apiName = postgrestContainerName(hash, normalizedSlug);
      try {
        await this.ctx.docker.getContainer(apiName).kill({ signal: "SIGUSR1" });
      } catch (err: unknown) {
        const code = getDockerEngineHttpStatus(err);
        if (code === 404 || code === 409) return moveResult;
        throw err;
      }

      return moveResult;
    } finally {
      await materialized.cleanup();
    }
  }

  /**
   * Drops the tenant API schema and replays a plain SQL file (e.g. `pg_dump` output), then reapplies
   * Flux grants and signals PostgREST to reload.
   */
  async replaceTenantApiSchemaFromPlainSqlFile(
    projectName: string,
    hash: string,
    hostFilePath: string,
    apiSchemaName: string,
  ): Promise<void> {
    assertFluxApiSchemaIdentifier(apiSchemaName);
    const { containerId, password, slug } =
      await this.resolveRunningPostgresCredentials(projectName, hash);
    const q = `"${apiSchemaName.replace(/"/g, '""')}"`;
    await runPsqlSqlInsideContainer(
      this.ctx.docker,
      containerId,
      password,
      `DROP SCHEMA IF EXISTS ${q} CASCADE;`,
      POSTGRES_USER,
    );
    const materialized = await materializePreparedSqlFile(
      hostFilePath,
      { sanitizeForTarget: true },
      () => queryPostgresMajorVersion(this.ctx.docker, containerId, password),
    );
    try {
      await runPsqlHostFileInsideContainer(
        this.ctx.docker,
        containerId,
        password,
        materialized.path,
        POSTGRES_USER,
      );
      await runPsqlSqlInsideContainer(
        this.ctx.docker,
        containerId,
        password,
        buildApiSchemaPrivilegesSql(apiSchemaName),
        POSTGRES_USER,
      );
      await runPsqlSqlInsideContainer(
        this.ctx.docker,
        containerId,
        password,
        `NOTIFY pgrst, 'reload schema';`,
        POSTGRES_USER,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      const apiName = postgrestContainerName(hash, slug);
      try {
        await this.ctx.docker.getContainer(apiName).kill({ signal: "SIGUSR1" });
      } catch (err: unknown) {
        const code = getDockerEngineHttpStatus(err);
        if (code !== 404 && code !== 409) throw err;
      }
    } finally {
      await materialized.cleanup();
    }
  }

  /**
   * Runs a read-only SELECT inside the tenant Postgres container; rows as JSON objects.
   */
  async queryTenantJsonRows(
    projectName: string,
    hash: string,
    selectSql: string,
  ): Promise<unknown[]> {
    const { containerId, password } =
      await this.resolveRunningPostgresCredentials(projectName, hash);
    return queryPsqlJsonRows(
      this.ctx.docker,
      containerId,
      password,
      selectSql,
      POSTGRES_USER,
    );
  }

  /**
   * Drops `public` and `auth` (if present) and reapplies {@link BOOTSTRAP_SQL} so the next
   * {@link importSqlFile} runs against a clean slate. Does not remove the Docker volume (use
   * {@link nukeProject} for that).
   */
  async resetTenantDatabaseForImport(
    projectName: string,
    hash: string,
    options?: { apiSchemaName?: string },
  ): Promise<void> {
    const apiSchema = options?.apiSchemaName?.trim() || LEGACY_FLUX_API_SCHEMA;
    assertFluxApiSchemaIdentifier(apiSchema);
    const { containerId, password } =
      await this.resolveRunningPostgresCredentials(projectName, hash);
    const qApi = `"${apiSchema.replace(/"/g, '""')}"`;
    const qLegacy = `"${LEGACY_FLUX_API_SCHEMA.replace(/"/g, '""')}"`;
    const dropLegacyApi =
      apiSchema !== LEGACY_FLUX_API_SCHEMA
        ? `DROP SCHEMA IF EXISTS ${qLegacy} CASCADE;\n`
        : "";
    const resetSql = `
DROP SCHEMA IF EXISTS ${qApi} CASCADE;
${dropLegacyApi}DROP SCHEMA IF EXISTS auth CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
ALTER SCHEMA public OWNER TO postgres;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
COMMENT ON SCHEMA public IS 'standard public schema';
`.trim();
    await runPsqlSqlInsideContainer(
      this.ctx.docker,
      containerId,
      password,
      resetSql,
      POSTGRES_USER,
    );
    await runPsqlSqlInsideContainer(
      this.ctx.docker,
      containerId,
      password,
      buildBootstrapSql(apiSchema),
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

    const containers = await this.ctx.docker.listContainers({
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

    const inspect = await this.ctx.docker.getContainer(match.Id).inspect();

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
    const containers = await this.ctx.docker.listContainers({ all: true });
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
          inspectContainerLifecycleState(this.ctx.docker, dbName),
          inspectContainerLifecycleState(this.ctx.docker, apiName),
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
      this.ctx.docker,
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
      this.ctx.docker,
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
      this.ctx.docker,
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
      this.ctx.docker,
      apiName,
      dbName,
      vol,
      privateNet,
    );
    try {
      await this.ctx.docker.getVolume(vol).inspect();
    } catch (e: unknown) {
      if (getDockerEngineHttpStatus(e) === 404) {
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
    const container = this.ctx.docker.getContainer(containerName);

    try {
      await container.inspect();
    } catch (e: unknown) {
      if (getDockerEngineHttpStatus(e) === 404) {
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
    const c = this.ctx.docker.getContainer(containerName);
    try {
      await c.inspect();
    } catch (e: unknown) {
      if (getDockerEngineHttpStatus(e) === 404) {
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
      await this.ctx.docker.getContainer(containerName).stop();
    } catch (err: unknown) {
      const code = getDockerEngineHttpStatus(err);
      if (code === 404) {
        throw new Error(`Container "${containerName}" does not exist.`);
      }
      if (code === 304) return;
      throw err;
    }
  }

  private async startContainerOrThrow(containerName: string): Promise<void> {
    try {
      await this.ctx.docker.getContainer(containerName).start();
    } catch (err: unknown) {
      const code = getDockerEngineHttpStatus(err);
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
    const listed = await this.ctx.docker.listNetworks({
      filters: { name: [name] },
    });
    if (!listed.some((n) => n.Name === name)) {
      try {
        await this.ctx.docker.createNetwork({
          Name: name,
          Driver: "bridge",
          Internal: true,
          CheckDuplicate: true,
        });
        onStatus?.(`Created internal network ${name}.`);
      } catch (err: unknown) {
        if (getDockerEngineHttpStatus(err) === 409) {
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
    await removeDockerNetworkByNameAllowMissing(this.ctx.docker, netName);
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
    const before = await this.ctx.docker.getContainer(containerId).inspect();
    const nets = before.NetworkSettings?.Networks ?? {};
    if (!nets[privateName]) {
      onStatus?.(`Attaching Postgres to ${privateName}…`);
      try {
        await this.ctx.docker
          .getNetwork(privateName)
          .connect({ Container: containerId });
      } catch (err: unknown) {
        if (getDockerEngineHttpStatus(err) !== 409) throw err;
      }
    }
    if (platform) {
      onStatus?.(
        `Ensuring platform Postgres stays on ${FLUX_NETWORK_NAME} (control plane access)…`,
      );
      await this.ensureContainerAttachedToFluxNetwork(containerId);
      return;
    }
    const after = await this.ctx.docker.getContainer(containerId).inspect();
    const hasFlux =
      (after.NetworkSettings?.Networks ?? {})[FLUX_NETWORK_NAME] != null;
    if (hasFlux) {
      onStatus?.(`Detaching Postgres from ${FLUX_NETWORK_NAME}…`);
      try {
        await this.ctx.docker.getNetwork(FLUX_NETWORK_NAME).disconnect({
          Container: containerId,
          Force: true,
        });
      } catch (err: unknown) {
        if (getDockerEngineHttpStatus(err) !== 404) throw err;
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
    const before = await this.ctx.docker.getContainer(containerId).inspect();
    const nets = before.NetworkSettings?.Networks ?? {};
    if (!nets[privateName]) {
      onStatus?.(`Attaching PostgREST to ${privateName}…`);
      try {
        await this.ctx.docker
          .getNetwork(privateName)
          .connect({ Container: containerId });
      } catch (err: unknown) {
        if (getDockerEngineHttpStatus(err) !== 409) throw err;
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
      await this.ctx.docker.getContainer(containerId).update({
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
    const networks = await this.ctx.docker.listNetworks({
      filters: { name: [FLUX_NETWORK_NAME] },
    });
    if (!networks.some((n) => n.Name === FLUX_NETWORK_NAME)) {
      await this.ctx.docker.createNetwork({
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
    const inspect = await fluxInspectContainerOrNull(this.ctx.docker, name);
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
    const inspect = await this.ctx.docker.getContainer(containerId).inspect();
    const nets = inspect.NetworkSettings.Networks ?? {};
    if (nets[FLUX_NETWORK_NAME]) return;
    try {
      await this.ctx.docker.getNetwork(FLUX_NETWORK_NAME).connect({
        Container: containerId,
      });
    } catch (err: unknown) {
      if (getDockerEngineHttpStatus(err) === 409) return;
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

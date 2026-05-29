import { freemem, loadavg, totalmem } from "node:os";
import { Readable } from "node:stream";

import {
  demuxDockerLogBufferIfMultiplexed,
  demuxDockerLogStream,
} from "../../docker-log-stream.ts";
import { POSTGRES_USER } from "../../docker/docker-constants.ts";
import {
  postgresContainerName,
  postgrestContainerName,
  projectPrivateNetworkName,
  tenantVolumeName,
} from "../../docker/docker-names.ts";
import { queryPsqlJsonRows } from "../../postgres-internal-exec.ts";
import type { FluxCoreContext } from "../../runtime/context.ts";
import {
  type FluxProjectSummary,
  fluxTenantStatusFromContainerPair,
  slugifyProjectName,
} from "../../standalone.ts";
import { fluxApiUrlForSlug } from "../../tenant-catalog-urls.ts";
import { FLUX_SYSTEM_HASH } from "../../tenant-suffix.ts";
import { getDockerEngineHttpStatus, removeApiPgAndVolumeForProvision } from "../delete-docker-tenant-stack.ts";
import { resolveRunningPostgresCredentials } from "./credentials.ts";
import {
  FLUX_TENANT_CONTAINER,
  inspectContainerLifecycleState,
  sleep,
  type ContainerLifecycleState,
} from "./docker-helpers.ts";
import type {
  DeleteProjectInfrastructureResult,
  FluxNodeStats,
  FluxProjectSlugRef,
  FluxSystemProjectActivity,
  NukeProjectOptions,
} from "./types.ts";

export async function getNodeStats(ctx: FluxCoreContext): Promise<FluxNodeStats> {
  const info = (await ctx.docker.info()) as { Containers?: number };
  const containerCount: number =
    typeof info.Containers === "number" && info.Containers >= 0
      ? info.Containers
      : (await ctx.docker.listContainers({ all: true })).length;
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

/**
 * Lists Flux tenant projects by scanning Docker for `flux-*-db` / `flux-*-api` containers.
 *
 * Returns only **slug**, **status**, and **apiUrl** — never Postgres passwords, connection URIs,
 * or JWT keys. Use {@link getProjectCredentials} when those values are required.
 */
export async function listProjects(
  ctx: FluxCoreContext,
): Promise<FluxProjectSummary[]> {
  const containers = await ctx.docker.listContainers({ all: true });
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
export async function getProjectSummariesForSlugs(
  ctx: FluxCoreContext,
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
        inspectContainerLifecycleState(ctx.docker, dbName),
        inspectContainerLifecycleState(ctx.docker, apiName),
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
export async function getProjectSummariesForUser(
  ctx: FluxCoreContext,
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
  return getProjectSummariesForSlugs(
    ctx,
    [...refs],
    isProduction ? { isProduction: true } : {},
  );
}

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
export async function lookupProjectHashBySlug(
  ctx: FluxCoreContext,
  slug: string,
  ownerKey?: string,
): Promise<string | null> {
  const normalized = slugifyProjectName(slug);
  const { containerId, password } = await resolveRunningPostgresCredentials(
    ctx,
    "flux-system",
    FLUX_SYSTEM_HASH,
  );
  const slugLit = `'${normalized.replace(/'/g, "''")}'`;
  const where = ownerKey
    ? `slug = ${slugLit} AND "userId" = '${ownerKey.replace(/'/g, "''")}'`
    : `slug = ${slugLit}`;
  const rows = (await queryPsqlJsonRows(
    ctx.docker,
    containerId,
    password,
    `SELECT hash FROM projects WHERE ${where} LIMIT 1`,
    POSTGRES_USER,
  )) as Array<{ hash: string }>;
  return rows[0]?.hash ?? null;
}

export async function stopInactiveProjects(
  ctx: FluxCoreContext,
  maxAgeDays: number,
): Promise<FluxSystemProjectActivity[]> {
  const { containerId, password } = await resolveRunningPostgresCredentials(
    ctx,
    "flux-system",
    FLUX_SYSTEM_HASH,
  );
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - maxAgeMs;

  const rows = await queryPsqlJsonRows(
    ctx.docker,
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
export async function reapIdleProjects(
  ctx: FluxCoreContext,
  maxIdleHours: number,
): Promise<{
  stopped: string[];
  errors: Array<{ slug: string; message: string }>;
}> {
  if (!Number.isFinite(maxIdleHours) || maxIdleHours <= 0) {
    throw new Error("maxIdleHours must be a positive number.");
  }
  const { containerId, password } = await resolveRunningPostgresCredentials(
    ctx,
    "flux-system",
    FLUX_SYSTEM_HASH,
  );
  const cutoff = new Date(Date.now() - maxIdleHours * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();

  const rows = await queryPsqlJsonRows(
    ctx.docker,
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
      await stopProject(ctx, row.slug, row.hash);
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
export async function stopProject(
  ctx: FluxCoreContext,
  name: string,
  hash: string,
): Promise<void> {
  const slug = slugifyProjectName(name);
  const apiName = postgrestContainerName(hash, slug);
  const dbName = postgresContainerName(hash, slug);
  await stopContainerOrThrow(ctx, apiName);
  await stopContainerOrThrow(ctx, dbName);
}

/**
 * Start stopped tenant containers: Postgres first, brief wait, then PostgREST.
 * Used by the control plane so the DB accepts connections before the API starts.
 */
export async function startProjectInfrastructure(
  ctx: FluxCoreContext,
  slug: string,
  hash: string,
): Promise<void> {
  const normalized = slugifyProjectName(slug);
  const dbName = postgresContainerName(hash, normalized);
  const apiName = postgrestContainerName(hash, normalized);
  await startContainerOrThrow(ctx, dbName);
  await sleep(2000);
  await startContainerOrThrow(ctx, apiName);
}

/**
 * Starts the Postgres and PostgREST containers (DB first, then API after a short delay).
 */
export async function startProject(
  ctx: FluxCoreContext,
  name: string,
  hash: string,
): Promise<void> {
  const slug = slugifyProjectName(name);
  await startProjectInfrastructure(ctx, slug, hash);
}

/**
 * Stops and removes both tenant containers and deletes the Postgres data volume.
 * Irreversible: all database files for the project are destroyed. Delegates to
 * {@link deleteProjectInfrastructure} (atomic: data volume must be gone afterward).
 */
export async function nukeProject(
  ctx: FluxCoreContext,
  name: string,
  options: NukeProjectOptions,
): Promise<void> {
  await deleteProjectInfrastructure(ctx, name, options.hash);
}

/**
 * **Atomic nuke protocol:** remove PostgREST + Postgres containers, delete named volume
 * `flux-{hash}-{slug}-db-data` (or confirm it was already missing), and remove the per-tenant
 * bridge. Resolves only after verifying the data volume is absent from the Engine.
 */
export async function deleteProjectInfrastructure(
  ctx: FluxCoreContext,
  slug: string,
  hash: string,
): Promise<DeleteProjectInfrastructureResult> {
  const normalized = slugifyProjectName(slug);
  const apiName = postgrestContainerName(hash, normalized);
  const dbName = postgresContainerName(hash, normalized);
  const vol = tenantVolumeName(hash, normalized);
  const privateNet = projectPrivateNetworkName(hash, normalized);
  await removeApiPgAndVolumeForProvision(
    ctx.docker,
    apiName,
    dbName,
    vol,
    privateNet,
  );
  try {
    await ctx.docker.getVolume(vol).inspect();
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
export async function nukeContainersOnly(
  ctx: FluxCoreContext,
  slug: string,
  hash: string,
): Promise<void> {
  await deleteProjectInfrastructure(ctx, slug, hash);
}

/**
 * Recent Docker logs for the tenant PostgREST (`api`) or Postgres (`db`) container.
 * Fetches stdout and stderr in separate Engine calls so responses are plain text (no stream demux).
 */
export async function getTenantContainerLogs(
  ctx: FluxCoreContext,
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
  const container = ctx.docker.getContainer(containerName);

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
export async function getContainerLogs(
  ctx: FluxCoreContext,
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
  const c = ctx.docker.getContainer(containerName);
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

export async function stopContainerOrThrow(
  ctx: FluxCoreContext,
  containerName: string,
): Promise<void> {
  try {
    await ctx.docker.getContainer(containerName).stop();
  } catch (err: unknown) {
    const code = getDockerEngineHttpStatus(err);
    if (code === 404) {
      throw new Error(`Container "${containerName}" does not exist.`);
    }
    if (code === 304) return;
    throw err;
  }
}

export async function startContainerOrThrow(
  ctx: FluxCoreContext,
  containerName: string,
): Promise<void> {
  try {
    await ctx.docker.getContainer(containerName).start();
  } catch (err: unknown) {
    const code = getDockerEngineHttpStatus(err);
    if (code === 404) {
      throw new Error(`Container "${containerName}" does not exist.`);
    }
    if (code === 304) return;
    throw err;
  }
}

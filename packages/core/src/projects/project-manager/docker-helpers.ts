import { createHmac, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import Docker from "dockerode";

import { POSTGRES_USER } from "../../docker/docker-constants.ts";
import {
  postgresContainerName,
} from "../../docker/docker-names.ts";
import { getDockerEngineHttpStatus } from "../delete-docker-tenant-stack.ts";
import { FLUX_PROJECT_HASH_HEX_LEN } from "../../tenant-suffix.ts";

export function randomHexChars(byteLength: number): string {
  return randomBytes(byteLength).toString("hex");
}

/**
 * When `FLUX_RESET_TENANT_VOLUME` is truthy (`1`, `true`, `yes`), {@link ProjectManager.provisionProject}
 * removes the tenant PostgREST + Postgres containers and the named volume before recreating Postgres
 * (fresh `PGDATA` with the password used in `PGRST_DB_URI`).
 */
export function fluxResetTenantVolumeEnabled(): boolean {
  const v = process.env.FLUX_RESET_TENANT_VOLUME?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Dev/test only: non-empty `FLUX_DEV_POSTGRES_PASSWORD` derives a stable Postgres password from the
 * tenant volume name so `POSTGRES_PASSWORD` and `PGRST_DB_URI` never drift. **Do not use in production.**
 */
export function fluxDevPostgresPasswordSecret(): string | undefined {
  const s = process.env.FLUX_DEV_POSTGRES_PASSWORD?.trim();
  return s && s.length > 0 ? s : undefined;
}

export function deterministicPostgresPasswordFromDevSecret(
  secret: string,
  volumeName: string,
): string {
  return createHmac("sha256", secret)
    .update(volumeName, "utf8")
    .digest("hex")
    .slice(0, 32);
}

export function sleep(ms: number): Promise<void> {
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
export async function waitForApiReachable(
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

export async function startFluxContainerIfStopped(
  container: Docker.Container,
): Promise<void> {
  const i = await container.inspect();
  if (!i.State.Running) {
    await container.start();
  }
}

/** `inspect()` for a named container, or `null` if it does not exist (404). */
export async function fluxInspectContainerOrNull(
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
export function envRecordFromDockerEnv(env: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of env ?? []) {
    const i = line.indexOf("=");
    if (i <= 0) continue;
    out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

export function dockerEnvFromRecord(record: Record<string, string>): string[] {
  return Object.keys(record)
    .sort((a, b) => a.localeCompare(b))
    .map((k) => `${k}=${record[k] ?? ""}`);
}

/** Ensures `PGRST_DB_URI` matches the current Postgres Docker DNS name (e.g. after tenant-hash renames). */
export function mergePostgrestEnvWithDbUri(
  existing: Record<string, string>,
  dbUri: string,
): Record<string, string> {
  return { ...existing, PGRST_DB_URI: dbUri };
}

/**
 * Reads `PGRST_JWT_SECRET` from `inspect.Config.Env` only — never generates or substitutes a secret.
 */
export function readPgrstJwtSecretFromContainerEnv(
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
export const FLUX_TENANT_CONTAINER = new RegExp(
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

export type ContainerLifecycleState = "running" | "stopped" | "missing";

export async function inspectContainerLifecycleState(
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

export async function ensureImage(
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

export async function ensureNamedVolume(docker: Docker, name: string): Promise<void> {
  try {
    await docker.createVolume({ Name: name });
  } catch (err: unknown) {
    if (getDockerEngineHttpStatus(err) === 409) return;
    throw err;
  }
}

export function postgresJdbcUri(
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
export function postgresDockerInternalUri(containerName: string, password: string): string {
  const user = encodeURIComponent(POSTGRES_USER);
  const pass = encodeURIComponent(password);
  return `postgres://${user}:${pass}@${containerName}:5432/postgres`;
}

import Docker from "dockerode";

import { FLUX_NETWORK_NAME } from "../../docker/docker-constants.ts";
import {
  FLUX_CORS_EXTRA_ORIGINS_LABEL,
  fluxContainerMetadataLabels,
  logTraefikLabelsForTenant,
  mergedPostgrestTraefikDockerLabels,
  parseAllowedOriginsList,
  stripLegacyUmbrellaMetadataFromLabels,
  traefikLabelsExactlyMatch,
} from "../../traefik/traefik-labels.ts";
import {
  isPlatformSystemStackSlug,
  postgrestContainerName,
  projectPrivateNetworkName,
} from "../../docker/docker-names.ts";
import {
  FLUX_TENANT_RESTART_POLICY,
  fluxTenantCpuNanoCpus,
  fluxTenantMemoryLimitBytes,
  tenantStackHostMemoryConfig,
} from "../../docker/docker-resources.ts";
import {
  fluxSystemPostgresHostPublishPort,
  fluxSystemPostgrestHostPublishPort,
  FLUX_SYSTEM_HOST_PORT_BIND,
} from "../../docker/system-publish-ports.ts";
import { isFluxSensitiveEnvKey } from "../../runtime/sensitive-env.ts";
import type { FluxCoreContext } from "../../runtime/context.ts";
import type { FluxProjectEnvEntry } from "../../standalone.ts";
import { slugifyProjectName } from "../../standalone.ts";
import { getDockerEngineHttpStatus } from "../delete-docker-tenant-stack.ts";
import {
  dockerEnvFromRecord,
  envRecordFromDockerEnv,
} from "./docker-helpers.ts";
import {
  alignPostgrestToBridgeAndPrivate,
  ensureProjectPrivateNetwork,
} from "./network.ts";
import type { ProvisionOptions } from "./types.ts";

export async function getPostgrestInspectOrThrow(
  ctx: FluxCoreContext,
  slugOrName: string,
  hash: string,
): Promise<Awaited<ReturnType<Docker.Container["inspect"]>>> {
  const slug = slugifyProjectName(slugOrName);
  const apiName = postgrestContainerName(hash, slug);
  try {
    return await ctx.docker.getContainer(apiName).inspect();
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
export async function createPostgresContainerForProvision(
  ctx: FluxCoreContext,
  opts: {
    name: string;
    password: string;
    volumeName: string;
    privateNet: string;
    slug: string;
  },
): Promise<Docker.Container> {
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
    return await ctx.docker.createContainer({
      name: opts.name,
      Image: ctx.images.postgres,
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
  return await ctx.docker.createContainer({
    name: opts.name,
    Image: ctx.images.postgres,
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
export async function replacePostgrestApiContainer(
  ctx: FluxCoreContext,
  slug: string,
  hash: string,
  inspect: Awaited<ReturnType<Docker.Container["inspect"]>>,
  mergedEnv: Record<string, string>,
  replaceOptions?: { labels?: Record<string, string> },
): Promise<void> {
  const apiName = postgrestContainerName(hash, slug);
  const container = ctx.docker.getContainer(inspect.Id);
  const env = dockerEnvFromRecord(mergedEnv);
  const wasRunning = inspect.State.Running;
  const privateNet = projectPrivateNetworkName(hash, slug);
  await ensureProjectPrivateNetwork(ctx, hash, slug);

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

  const created = await ctx.docker.createContainer({
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
    await alignPostgrestToBridgeAndPrivate(ctx, newInspect.Id, hash, slug);
  }
}

/**
 * Merges `envs` into the PostgREST/API container’s existing `Config.Env`, recreates the
 * container (same image, Traefik labels, network, limits), and starts it if it was running
 * so new variables (e.g. custom app config) take effect.
 */
export async function setProjectEnv(
  ctx: FluxCoreContext,
  slug: string,
  envs: Record<string, string>,
  hash: string,
): Promise<void> {
  const normalized = slugifyProjectName(slug);
  const existing = await getPostgrestInspectOrThrow(ctx, normalized, hash);
  const merged = {
    ...envRecordFromDockerEnv(existing.Config.Env),
    ...envs,
  };
  await replacePostgrestApiContainer(
    ctx,
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
export async function setPostgrestSupabaseRestPrefix(
  ctx: FluxCoreContext,
  projectName: string,
  enabled: boolean,
  hash: string,
): Promise<void> {
  const slug = slugifyProjectName(projectName);
  const existing = await getPostgrestInspectOrThrow(ctx, slug, hash);
  const merged = envRecordFromDockerEnv(existing.Config.Env);
  const labels = mergedPostgrestTraefikDockerLabels(
    existing.Config.Labels ?? {},
    slug,
    hash,
    enabled,
  );
  await replacePostgrestApiContainer(ctx, slug, hash, existing, merged, {
    labels,
  });
}

/**
 * Recreates the PostgREST container if the current per-tenant Traefik label set (TLS, entrypoints,
 * CORS, strip) does not match Docker, so a second `flux create` can sync the gateway. Idempotent.
 */
export async function reconcilePostgrestTraefikLabels(
  ctx: FluxCoreContext,
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
  const existing = await getPostgrestInspectOrThrow(ctx, slug, hash);
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
  await replacePostgrestApiContainer(ctx, slug, hash, existing, env, {
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
export async function getProjectAllowedOrigins(
  ctx: FluxCoreContext,
  projectName: string,
  hash: string,
): Promise<readonly string[]> {
  const slug = slugifyProjectName(projectName);
  const existing = await getPostgrestInspectOrThrow(ctx, slug, hash);
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
export async function setProjectAllowedOrigins(
  ctx: FluxCoreContext,
  projectName: string,
  origins: readonly string[],
  hash: string,
  options?: { onStatus?: (message: string) => void },
): Promise<void> {
  const reconcileOpts: Parameters<
    typeof reconcilePostgrestTraefikLabels
  >[3] = { additionalAllowedOrigins: origins };
  if (options?.onStatus) reconcileOpts.onStatus = options.onStatus;
  await reconcilePostgrestTraefikLabels(ctx, projectName, hash, reconcileOpts);
}

/**
 * Returns env entries from the PostgREST container. Sensitive keys omit values; use
 * {@link isFluxSensitiveEnvKey} for the rule set.
 */
export async function listProjectEnv(
  ctx: FluxCoreContext,
  slug: string,
  hash: string,
): Promise<FluxProjectEnvEntry[]> {
  const normalized = slugifyProjectName(slug);
  const inspect = await getPostgrestInspectOrThrow(ctx, normalized, hash);
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
export async function updatePostgrestJwtSecret(
  ctx: FluxCoreContext,
  projectName: string,
  newJwtSecret: string,
  hash: string,
): Promise<void> {
  const secret = newJwtSecret.trim();
  if (!secret) {
    throw new Error("JWT secret cannot be empty.");
  }
  const slug = slugifyProjectName(projectName);
  await setProjectEnv(ctx, slug, { PGRST_JWT_SECRET: secret }, hash);
}

import {
  FLUX_GATEWAY_CONTAINER_NAME,
  FLUX_NETWORK_NAME,
} from "../../docker/docker-constants.ts";
import {
  isPlatformSystemStackSlug,
  projectPrivateNetworkName,
} from "../../docker/docker-names.ts";
import {
  FLUX_TENANT_RESTART_POLICY,
  fluxTenantCpuNanoCpus,
  tenantStackHostMemoryConfig,
} from "../../docker/docker-resources.ts";
import type { FluxCoreContext } from "../../runtime/context.ts";
import {
  getDockerEngineHttpStatus,
  removeDockerNetworkByNameAllowMissing,
} from "../delete-docker-tenant-stack.ts";
import { fluxInspectContainerOrNull } from "./docker-helpers.ts";
import { slugifyProjectName } from "../../standalone.ts";

export async function ensureFluxNetwork(
  ctx: FluxCoreContext,
  onStatus?: (message: string) => void,
): Promise<void> {
  onStatus?.(`Checking Docker network ${FLUX_NETWORK_NAME}…`);
  const networks = await ctx.docker.listNetworks({
    filters: { name: [FLUX_NETWORK_NAME] },
  });
  if (!networks.some((n) => n.Name === FLUX_NETWORK_NAME)) {
    await ctx.docker.createNetwork({
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
export async function ensureFluxGateway(
  ctx: FluxCoreContext,
  onStatus?: (message: string) => void,
): Promise<void> {
  const name = FLUX_GATEWAY_CONTAINER_NAME;
  onStatus?.(`Checking Traefik gateway ${name}…`);
  const inspect = await fluxInspectContainerOrNull(ctx.docker, name);
  if (inspect?.State.Running) {
    onStatus?.(`Gateway ${name} is running.`);
    return;
  }
  const text =
    "Infrastructure Gateway is missing (no running container named flux-gateway; manage Traefik with external compose on flux-network if needed).";
  if (onStatus) onStatus(`⚠ ${text}`);
  else console.warn(`⚠ ${text}`);
}

/**
 * Isolated per-tenant bridge used only for Postgres + PostgREST (internal: no default route to
 * the public internet; tenant DB is not on {@link FLUX_NETWORK_NAME}).
 */
export async function ensureProjectPrivateNetwork(
  ctx: FluxCoreContext,
  hash: string,
  slug: string,
  onStatus?: (message: string) => void,
): Promise<string> {
  const name = projectPrivateNetworkName(hash, slug);
  onStatus?.(`Checking Docker network ${name}…`);
  const listed = await ctx.docker.listNetworks({
    filters: { name: [name] },
  });
  if (!listed.some((n) => n.Name === name)) {
    try {
      await ctx.docker.createNetwork({
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

export async function ensureContainerAttachedToFluxNetwork(
  ctx: FluxCoreContext,
  containerId: string,
): Promise<void> {
  const inspect = await ctx.docker.getContainer(containerId).inspect();
  const nets = inspect.NetworkSettings.Networks ?? {};
  if (nets[FLUX_NETWORK_NAME]) return;
  try {
    await ctx.docker.getNetwork(FLUX_NETWORK_NAME).connect({
      Container: containerId,
    });
  } catch (err: unknown) {
    if (getDockerEngineHttpStatus(err) === 409) return;
    throw err;
  }
}

/**
 * Isolates tenant Postgres on the private network only. The platform `flux-system` DB is an
 * exception: it stays on the private network **and** {@link FLUX_NETWORK_NAME} so the dashboard
 * (or other bridge-only services) can open `Pool` / Drizzle to `getPostgresHostConnectionString`.
 */
export async function alignPostgresToPrivateOnlyNetwork(
  ctx: FluxCoreContext,
  containerId: string,
  hash: string,
  slug: string,
  onStatus?: (message: string) => void,
): Promise<void> {
  const privateName = projectPrivateNetworkName(hash, slug);
  const platform = isPlatformSystemStackSlug(slug);
  await ensureProjectPrivateNetwork(ctx, hash, slug, onStatus);
  const before = await ctx.docker.getContainer(containerId).inspect();
  const nets = before.NetworkSettings?.Networks ?? {};
  if (!nets[privateName]) {
    onStatus?.(`Attaching Postgres to ${privateName}…`);
    try {
      await ctx.docker
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
    await ensureContainerAttachedToFluxNetwork(ctx, containerId);
    return;
  }
  const after = await ctx.docker.getContainer(containerId).inspect();
  const hasFlux =
    (after.NetworkSettings?.Networks ?? {})[FLUX_NETWORK_NAME] != null;
  if (hasFlux) {
    onStatus?.(`Detaching Postgres from ${FLUX_NETWORK_NAME}…`);
    try {
      await ctx.docker.getNetwork(FLUX_NETWORK_NAME).disconnect({
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
export async function alignPostgrestToBridgeAndPrivate(
  ctx: FluxCoreContext,
  containerId: string,
  hash: string,
  slug: string,
  onStatus?: (message: string) => void,
): Promise<void> {
  const privateName = projectPrivateNetworkName(hash, slug);
  await ensureProjectPrivateNetwork(ctx, hash, slug, onStatus);
  const before = await ctx.docker.getContainer(containerId).inspect();
  const nets = before.NetworkSettings?.Networks ?? {};
  if (!nets[privateName]) {
    onStatus?.(`Attaching PostgREST to ${privateName}…`);
    try {
      await ctx.docker
        .getNetwork(privateName)
        .connect({ Container: containerId });
    } catch (err: unknown) {
      if (getDockerEngineHttpStatus(err) !== 409) throw err;
    }
  }
  await ensureContainerAttachedToFluxNetwork(ctx, containerId);
}

/** Best-effort: sync memory / CPU / restart policy to current tenant defaults (idempotent for new containers). */
export async function applyTenantResourceLimits(
  ctx: FluxCoreContext,
  containerId: string,
  onStatus?: (message: string) => void,
): Promise<void> {
  try {
    await ctx.docker.getContainer(containerId).update({
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
 * Removes the tenant’s private `flux-${hash}-${slug}-net` if it still exists, disconnecting
 * endpoints first. Idempotent. Call after nuke, before (re)provision, so repair does not hit
 * duplicate-network errors.
 */
export async function removeTenantPrivateNetworkAllowMissing(
  ctx: FluxCoreContext,
  slug: string,
  hash: string,
): Promise<void> {
  const normalized = slugifyProjectName(slug);
  const netName = projectPrivateNetworkName(hash, normalized);
  await removeDockerNetworkByNameAllowMissing(ctx.docker, netName);
}

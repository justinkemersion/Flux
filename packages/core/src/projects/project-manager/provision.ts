import Docker from "dockerode";

import {
  assertFluxApiSchemaIdentifier,
  LEGACY_FLUX_API_SCHEMA,
} from "../../api-schema-strategy.ts";
import { buildBootstrapSql, pgrstDbSchemasEnvValue } from "../../database/bootstrap-sql.ts";
import {
  runPsqlSqlInsideContainer,
  waitPostgresReadyInsideContainer,
} from "../../postgres-internal-exec.ts";
import {
  FLUX_NETWORK_NAME,
  POSTGRES_USER,
} from "../../docker/docker-constants.ts";
import {
  isPlatformSystemStackSlug,
  postgresContainerName,
  postgrestContainerName,
  tenantVolumeName,
} from "../../docker/docker-names.ts";
import {
  FLUX_TENANT_RESTART_POLICY,
  fluxTenantCpuNanoCpus,
  tenantStackHostMemoryConfig,
} from "../../docker/docker-resources.ts";
import {
  fluxSystemPostgrestHostPublishPort,
  FLUX_SYSTEM_HOST_PORT_BIND,
} from "../../docker/system-publish-ports.ts";
import {
  logTraefikLabelsForTenant,
  mergedPostgrestTraefikDockerLabels,
  postgrestTraefikDockerLabels,
  traefikLabelsExactlyMatch,
} from "../../traefik/traefik-labels.ts";
import {
  assertFluxDockerEngineReachableOrThrow,
  formatDockerEngineTarget,
} from "../../docker/docker-client.ts";
import type { FluxCoreContext } from "../../runtime/context.ts";
import { generateProjectHash } from "../../tenant-suffix.ts";
import { slugifyProjectName } from "../../standalone.ts";
import { fluxApiUrlForSlug } from "../../tenant-catalog-urls.ts";
import { removeApiPgAndVolumeForProvision } from "../delete-docker-tenant-stack.ts";
import {
  deterministicPostgresPasswordFromDevSecret,
  ensureImage,
  ensureNamedVolume,
  envRecordFromDockerEnv,
  fluxDevPostgresPasswordSecret,
  fluxInspectContainerOrNull,
  fluxResetTenantVolumeEnabled,
  mergePostgrestEnvWithDbUri,
  postgresJdbcUri,
  randomHexChars,
  readPgrstJwtSecretFromContainerEnv,
  sleep,
  startFluxContainerIfStopped,
  waitForApiReachable,
} from "./docker-helpers.ts";
import {
  alignPostgresToPrivateOnlyNetwork,
  alignPostgrestToBridgeAndPrivate,
  applyTenantResourceLimits,
  ensureFluxGateway,
  ensureFluxNetwork,
  ensureProjectPrivateNetwork,
} from "./network.ts";
import {
  createPostgresContainerForProvision,
  replacePostgrestApiContainer,
} from "./postgrest.ts";
import type { FluxProject, ProvisionOptions } from "./types.ts";

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
export async function provisionProject(
  ctx: FluxCoreContext,
  name: string,
  options?: ProvisionOptions,
  hash?: string,
): Promise<FluxProject> {
  const log = options?.onStatus;
  const targetBody = `Targeting Docker Engine: ${formatDockerEngineTarget(ctx.docker)}`;
  if (log) {
    log(targetBody);
  } else {
    console.log(`▸ ${targetBody}`);
  }
  await assertFluxDockerEngineReachableOrThrow(ctx.docker);
  await ensureFluxNetwork(ctx, log);
  await ensureFluxGateway(ctx, log);
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
  const privateNet = await ensureProjectPrivateNetwork(
    ctx,
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
      ctx.docker,
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
  await ensureNamedVolume(ctx.docker, volumeName);
  log?.("Ensuring container images…");
  await ensureImage(ctx.docker, ctx.images.postgres, log);
  await ensureImage(ctx.docker, ctx.images.postgrest, log);

  let pgContainer: Docker.Container;
  const pgExisting = await fluxInspectContainerOrNull(
    ctx.docker,
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
      pgContainer = ctx.docker.getContainer(pgContainerName);
    } else {
      log?.(`Creating Postgres container ${pgContainerName}…`);
      pgContainer = await createPostgresContainerForProvision(ctx, {
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
    pgContainer = ctx.docker.getContainer(pgContainerName);
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
    pgContainer = await createPostgresContainerForProvision(ctx, {
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
  await alignPostgresToPrivateOnlyNetwork(ctx, pgInspect.Id, projectHash, slug, log);
  await applyTenantResourceLimits(ctx, pgInspect.Id, log);

  await waitPostgresReadyInsideContainer(
    ctx.docker,
    pgInspect.Id,
    log
      ? { onStatus: log, maxAttempts: 80 }
      : { maxAttempts: 80 },
  );
  await runPsqlSqlInsideContainer(
    ctx.docker,
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
    ctx.docker,
    apiContainerName,
  );
  if (apiExisting) {
    log?.(
      `PostgREST container "${apiContainerName}" already exists; resuming (start if stopped, reuse JWT)…`,
    );
    apiContainer = ctx.docker.getContainer(apiContainerName);
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
      await replacePostgrestApiContainer(
        ctx,
        slug,
        projectHash,
        apiExisting,
        envWithDbUri,
        { labels: mergedTraefik },
      );
      apiContainer = ctx.docker.getContainer(apiContainerName);
    } else if (dbUriOutOfDate) {
      log?.(
        "PostgREST PGRST_DB_URI does not match Postgres container hostname; recreating API container…",
      );
      await replacePostgrestApiContainer(
        ctx,
        slug,
        projectHash,
        apiExisting,
        envWithDbUri,
        { labels: mergedTraefik },
      );
      apiContainer = ctx.docker.getContainer(apiContainerName);
    }
  } else {
    log?.(`Creating PostgREST container ${apiContainerName}…`);
    const systemPgrstHostPort = fluxSystemPostgrestHostPublishPort(slug);
    apiContainer = await ctx.docker.createContainer({
      name: apiContainerName,
      Image: ctx.images.postgrest,
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
  await alignPostgrestToBridgeAndPrivate(ctx, apiInspect.Id, projectHash, slug, log);
  await applyTenantResourceLimits(ctx, apiInspect.Id, log);
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

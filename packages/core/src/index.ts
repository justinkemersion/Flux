import { randomBytes } from "node:crypto";
import { finished } from "node:stream/promises";
import Docker from "dockerode";
import pg from "pg";

export const FLUX_NETWORK_NAME = "flux-network";

/** Pinned images for Flux project stacks (Postgres + PostgREST). */
export const FLUX_DOCKER_IMAGES = {
  postgres: "postgres:16-alpine",
  postgrest: "postgrest/postgrest:latest",
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
 */
export const BOOTSTRAP_SQL = `
-- Schema that PostgREST will expose (PGRST_DB_SCHEMA=api)
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

-- Allow request roles to use the api schema
GRANT USAGE ON SCHEMA api TO anon, authenticated;
`.trim();

function randomHexChars(byteLength: number): string {
  return randomBytes(byteLength).toString("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function hostPortFromInspectOptional(
  inspect: {
    NetworkSettings: { Ports?: Record<string, Array<{ HostPort?: string }> | null> };
  },
  containerPort: "5432/tcp" | "3000/tcp",
): number | undefined {
  const bindings = inspect.NetworkSettings.Ports?.[containerPort];
  const hostPort = bindings?.[0]?.HostPort;
  return hostPort ? Number.parseInt(hostPort, 10) : undefined;
}

function tenantVolumeName(slug: string): string {
  return `flux-${slug}-db-data`;
}

/** Flux tenant container name pattern: flux-&lt;slug&gt;-db | flux-&lt;slug&gt;-api */
const FLUX_TENANT_CONTAINER = /^flux-(.+)-(db|api)$/;

/** Row returned by {@link ProjectManager.listProjects}. */
export interface FluxProjectSummary {
  /** Normalized project slug (from container names). */
  slug: string;
  /** Combined health of Postgres + PostgREST containers. */
  status: "running" | "stopped" | "partial";
  /** Published host port for the PostgREST container (maps to 3000), when known. */
  apiHostPort?: number;
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
    onStatus?.(
      `Pulling ${image} — the first run can take several minutes; please wait…`,
    );
    const stream = await docker.pull(image);
    await finished(stream);
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
    /** Host port mapped to the PostgREST listen port (default 3000 in image). */
    hostPort?: number;
  };
  /** Generated secret for PostgREST JWT verification — treat as sensitive. */
  jwtSecret: string;
  /** Generated Postgres superuser password — treat as sensitive. */
  postgresPassword: string;
}

/** Optional hooks for long-running {@link ProjectManager.provisionProject} work (CLIs, logs). */
export interface ProvisionOptions {
  onStatus?: (message: string) => void;
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
   * PostgREST is started with RestartPolicy `on-failure` (with a retry cap) so it survives Postgres
   * startup races without a Node-side health probe; a short delay after Postgres start reduces churn
   * during first-time volume initialization.
   */
  async provisionProject(
    name: string,
    options?: ProvisionOptions,
  ): Promise<FluxProject> {
    const log = options?.onStatus;
    log?.("Checking Docker network…");
    await this.ensureFluxNetwork();
    log?.(`Network ${FLUX_NETWORK_NAME} is ready.`);
    const slug = slugifyProjectName(name);
    const postgresPassword = randomHexChars(16);
    const jwtSecret = randomHexChars(32);

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

    let apiContainer: Docker.Container;
    log?.(`Creating PostgREST container ${apiContainerName}…`);
    try {
      apiContainer = await this.docker.createContainer({
        name: apiContainerName,
        Image: POSTGREST_IMAGE,
        Env: [
          `PGRST_DB_URI=${dbUri}`,
          `PGRST_JWT_SECRET=${jwtSecret}`,
          `PGRST_DB_SCHEMA=api`,
          `PGRST_DB_ANON_ROLE=anon`,
        ],
        ExposedPorts: { "3000/tcp": {} },
        HostConfig: {
          NetworkMode: FLUX_NETWORK_NAME,
          PortBindings: {
            "3000/tcp": [{ HostIp: "0.0.0.0", HostPort: "0" }],
          },
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
    const postgrestHostPort = hostPortForTcp(apiInspect, "3000/tcp");

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
        hostPort: postgrestHostPort,
      },
      jwtSecret,
      postgresPassword,
    };
  }

  /**
   * Runs arbitrary SQL against an existing Flux project's Postgres instance.
   *
   * Retrieves connection details (host port, password) from the running container's
   * inspect data so callers don't need to store credentials out of band.
   */
  async executeSql(projectName: string, sql: string): Promise<void> {
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

    await runSql(hostPort, password, sql);

    await this.signalPostgrestSchemaReload(slug);
  }

  /**
   * Tells PostgREST to reload its schema cache (Docker SIGHUP) so new tables show up without a full restart.
   * No-op if the API container is missing or not running.
   */
  private async signalPostgrestSchemaReload(slug: string): Promise<void> {
    const apiName = postgrestContainerName(slug);
    try {
      await this.docker.getContainer(apiName).kill({ signal: "SIGHUP" });
    } catch (err: unknown) {
      const code = getHttpStatus(err);
      if (code === 404 || code === 409) return;
      throw err;
    }
  }

  /**
   * Lists Flux tenant projects by scanning Docker for `flux-*-db` / `flux-*-api` containers.
   */
  async listProjects(): Promise<FluxProjectSummary[]> {
    const containers = await this.docker.listContainers({ all: true });
    const bySlug = new Map<
      string,
      { dbState?: string; apiState?: string; apiId?: string }
    >();

    for (const c of containers) {
      const raw = c.Names?.[0]?.replace(/^\//, "") ?? "";
      const m = raw.match(FLUX_TENANT_CONTAINER);
      if (!m?.[1] || !m[2]) continue;
      const slug = m[1];
      const kind = m[2] as "db" | "api";
      const cur = bySlug.get(slug) ?? {};
      if (kind === "db") cur.dbState = c.State;
      else {
        cur.apiState = c.State;
        cur.apiId = c.Id;
      }
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

      let apiHostPort: number | undefined;
      if (e.apiId) {
        try {
          const inspect = await this.docker.getContainer(e.apiId).inspect();
          apiHostPort = hostPortFromInspectOptional(inspect, "3000/tcp");
        } catch {
          /* ignore */
        }
      }

      rows.push({
        slug,
        status,
        ...(apiHostPort !== undefined ? { apiHostPort } : {}),
      });
    }

    return rows.sort((a, b) => a.slug.localeCompare(b.slug));
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

  /** Ensures a Docker bridge network named {@link FLUX_NETWORK_NAME} exists. */
  private async ensureFluxNetwork(): Promise<void> {
    const networks = await this.docker.listNetworks({
      filters: { name: [FLUX_NETWORK_NAME] },
    });
    if (networks.some((n) => n.Name === FLUX_NETWORK_NAME)) return;

    await this.docker.createNetwork({
      Name: FLUX_NETWORK_NAME,
      Driver: "bridge",
      CheckDuplicate: true,
    });
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

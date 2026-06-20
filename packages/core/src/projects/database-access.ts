/**
 * Mode-aware private database access metadata for CLI, dashboard, and API routes.
 * Redacted plans never include passwords, connection strings, or pooled admin credentials.
 */
import { POSTGRES_USER } from "../docker/docker-constants.ts";
import {
  postgresContainerName,
  projectPrivateNetworkName,
} from "../docker/docker-names.ts";
import {
  resolveTenantApiSchemaName,
  type ProjectApiSchemaInput,
} from "../api-schema-strategy.ts";
import { dbAccessReadwriteEnabled } from "./db-access-roles.ts";

export type DatabaseAccessTransport = "ssh_tunnel";

export type DatabaseAccessCapabilities = {
  tunnel: boolean;
  guiConfig: boolean;
  shell: boolean;
  dump: boolean;
  restore: boolean;
  readonly: boolean;
  readwrite: boolean;
  temporaryCredentials: boolean;
};

export type DatabaseAccessTunnelDefaults = {
  sshHost: string;
  sshUser: string;
  sshPort: number;
  recommendedLocalHost: "127.0.0.1";
  recommendedLocalPort: number;
};

export type DedicatedDatabaseAccessPlan = {
  mode: "v1_dedicated";
  supported: true;
  projectName: string;
  projectHash: string;
  engine: "postgres";
  transport: DatabaseAccessTransport;
  scope: "whole_database";
  database: {
    databaseName: "postgres";
    username: typeof POSTGRES_USER;
    internalHost: string;
    internalPort: number;
    containerName: string;
    dockerNetworkName: string;
    sslMode: "disable";
  };
  tunnel: DatabaseAccessTunnelDefaults;
  credentialStrategy: "project_postgres_password" | "readonly_project_password";
  capabilities: DatabaseAccessCapabilities;
};

export type PooledDatabaseAccessPlan = {
  mode: "v2_shared";
  supported: true;
  projectName: string;
  projectHash: string;
  engine: "postgres";
  transport: DatabaseAccessTransport;
  scope: "tenant_schema";
  tenantSchema: string;
  database: {
    databaseName: "postgres";
    internalHost: string;
    internalPort: number;
    containerName?: string;
    sslMode: "disable";
    searchPath: string[];
  };
  tunnel: DatabaseAccessTunnelDefaults;
  credentialStrategy: "temporary_project_scoped_role";
  defaultAccess: "readonly";
  securityNotes: readonly string[];
  capabilities: DatabaseAccessCapabilities;
};

/** @deprecated Pass 1 preview alias — use PooledDatabaseAccessPlan */
export type PooledDatabaseAccessPreviewPlan = PooledDatabaseAccessPlan;

export type DatabaseAccessPlan =
  | DedicatedDatabaseAccessPlan
  | PooledDatabaseAccessPlan;

export type ResolveProjectDatabaseAccessInput = ProjectApiSchemaInput & {
  slug: string;
  hash: string;
};

export type ResolveProjectDatabaseAccessOptions = {
  localPort?: number;
  sshHost?: string;
  sshUser?: string;
  sshPort?: number;
  sharedPostgresInternalHost?: string;
  sharedPostgresInternalPort?: number;
  sharedPostgresContainerName?: string;
};

const DEFAULT_LOCAL_PORT = 15_432;
const DEFAULT_SSH_PORT = 22;
const DEFAULT_SSH_USER = "root";
const V2_SECURITY_NOTES = [
  "Schema grants and RLS enforce tenant isolation — search_path is a GUI convenience only.",
  "PostgreSQL may expose some catalog metadata to connected roles.",
  "Pooled admin credentials are never used for private database access.",
] as const;

function parseSshHostFromDockerHost(): { host?: string; user?: string } {
  const raw = process.env.DOCKER_HOST?.trim();
  if (!raw?.startsWith("ssh://")) return {};
  try {
    const u = new URL(raw);
    const out: { host?: string; user?: string } = {};
    if (u.hostname) out.host = u.hostname;
    if (u.username) out.user = u.username;
    return out;
  } catch {
    return {};
  }
}

export function resolveDefaultSshTunnelConfig(
  overrides?: Pick<
    ResolveProjectDatabaseAccessOptions,
    "sshHost" | "sshUser" | "sshPort"
  >,
): Pick<DatabaseAccessTunnelDefaults, "sshHost" | "sshUser" | "sshPort"> {
  const fromDocker = parseSshHostFromDockerHost();
  const sshHost =
    overrides?.sshHost?.trim() ||
    process.env.FLUX_DB_TUNNEL_SSH_HOST?.trim() ||
    fromDocker.host ||
    "";
  const sshUser =
    overrides?.sshUser?.trim() ||
    process.env.FLUX_DB_TUNNEL_SSH_USER?.trim() ||
    fromDocker.user ||
    DEFAULT_SSH_USER;
  const sshPortRaw =
    overrides?.sshPort ??
    Number.parseInt(process.env.FLUX_DB_TUNNEL_SSH_PORT?.trim() ?? "", 10);
  const sshPort =
    Number.isFinite(sshPortRaw) && sshPortRaw > 0 ? sshPortRaw : DEFAULT_SSH_PORT;
  return { sshHost, sshUser, sshPort };
}

export function resolveSharedPostgresTunnelTarget(
  overrides?: Pick<
    ResolveProjectDatabaseAccessOptions,
    | "sharedPostgresInternalHost"
    | "sharedPostgresInternalPort"
    | "sharedPostgresContainerName"
  >,
): {
  internalHost: string;
  internalPort: number;
  containerName?: string;
} {
  const explicitHost = overrides?.sharedPostgresInternalHost?.trim();
  const explicitPort = overrides?.sharedPostgresInternalPort;
  const explicitContainer = overrides?.sharedPostgresContainerName?.trim();

  if (explicitHost) {
    return {
      internalHost: explicitHost,
      internalPort:
        explicitPort && explicitPort > 0 ? explicitPort : 5432,
      ...(explicitContainer ? { containerName: explicitContainer } : {}),
    };
  }

  const envHost = process.env.FLUX_SHARED_POSTGRES_TUNNEL_HOST?.trim();
  const envPort = Number.parseInt(
    process.env.FLUX_SHARED_POSTGRES_TUNNEL_PORT?.trim() ?? "",
    10,
  );
  const envContainer = process.env.FLUX_SHARED_POSTGRES_TUNNEL_CONTAINER?.trim();

  if (envHost) {
    return {
      internalHost: envHost,
      internalPort: Number.isFinite(envPort) && envPort > 0 ? envPort : 5432,
      ...(envContainer ? { containerName: envContainer } : {}),
    };
  }

  const sharedUrl = process.env.FLUX_SHARED_POSTGRES_URL?.trim();
  if (sharedUrl) {
    try {
      const normalized = sharedUrl.startsWith("postgres://")
        ? `postgresql://${sharedUrl.slice("postgres://".length)}`
        : sharedUrl;
      const u = new URL(normalized);
      return {
        internalHost: u.hostname,
        internalPort: u.port ? Number(u.port) : 5432,
        ...(envContainer || u.hostname
          ? { containerName: envContainer || u.hostname }
          : {}),
      };
    } catch {
      /* fall through */
    }
  }

  return {
    internalHost: "flux-pool-postgres",
    internalPort: 5432,
    containerName: envContainer || "flux-pool-postgres",
  };
}

export function resolveProjectDatabaseAccess(
  project: ResolveProjectDatabaseAccessInput,
  options: ResolveProjectDatabaseAccessOptions = {},
): DatabaseAccessPlan {
  const slug = project.slug.trim();
  const hash = project.hash.trim().toLowerCase();
  const localPort = options.localPort ?? DEFAULT_LOCAL_PORT;
  const ssh = resolveDefaultSshTunnelConfig(options);

  const tunnel: DatabaseAccessTunnelDefaults = {
    ...ssh,
    recommendedLocalHost: "127.0.0.1",
    recommendedLocalPort: localPort,
  };

  if (project.mode === "v2_shared") {
    const tenantSchema = resolveTenantApiSchemaName(project);
    const poolTarget = resolveSharedPostgresTunnelTarget(options);
    return {
      mode: "v2_shared",
      supported: true,
      projectName: slug,
      projectHash: hash,
      engine: "postgres",
      transport: "ssh_tunnel",
      scope: "tenant_schema",
      tenantSchema,
      database: {
        databaseName: "postgres",
        internalHost: poolTarget.internalHost,
        internalPort: poolTarget.internalPort,
        sslMode: "disable",
        searchPath: [tenantSchema, "public"],
        ...(poolTarget.containerName
          ? { containerName: poolTarget.containerName }
          : {}),
      },
      tunnel,
      credentialStrategy: "temporary_project_scoped_role",
      defaultAccess: "readonly",
      securityNotes: V2_SECURITY_NOTES,
      capabilities: {
        tunnel: true,
        guiConfig: true,
        shell: true,
        dump: true,
        restore: false,
        readonly: true,
        readwrite: dbAccessReadwriteEnabled(),
        temporaryCredentials: true,
      },
    };
  }

  const containerName = postgresContainerName(hash, slug);
  return {
    mode: "v1_dedicated",
    supported: true,
    projectName: slug,
    projectHash: hash,
    engine: "postgres",
    transport: "ssh_tunnel",
    scope: "whole_database",
    database: {
      databaseName: "postgres",
      username: POSTGRES_USER,
      internalHost: containerName,
      internalPort: 5432,
      containerName,
      dockerNetworkName: projectPrivateNetworkName(hash, slug),
      sslMode: "disable",
    },
    tunnel,
    credentialStrategy: "project_postgres_password",
    capabilities: {
      tunnel: true,
      guiConfig: true,
      shell: false,
      dump: false,
      restore: false,
      readonly: true,
      readwrite: true,
      temporaryCredentials: false,
    },
  };
}

/** Strip any accidental secret fields before JSON responses or verbose logs. */
export function redactDatabaseAccessPlan(plan: DatabaseAccessPlan): DatabaseAccessPlan {
  return structuredClone(plan);
}

import type { DatabaseAccessPlan, DbAccessLevel } from "@flux/core";
import type { TemporaryDbCredential } from "../api-client/db-access";
import {
  DEFAULT_DB_TUNNEL_LOCAL_PORT,
  resolveLocalTunnelPort,
  waitForLocalPortAccepting,
} from "./local-port";
import {
  buildSshTunnelArgs,
  openSshTunnel,
  resolveRemoteTunnelTarget,
} from "./ssh-tunnel";

export type DbConnectionAuth =
  | {
      mode: "v1_dedicated";
      username: string;
      password: string;
    }
  | {
      mode: "v2_shared";
      credential: TemporaryDbCredential;
    };

export type OpenDbTunnelInput = {
  plan: DatabaseAccessPlan;
  localHost: string;
  localPort?: number;
  strictPort?: boolean;
  sshHost?: string;
  sshUser?: string;
  sshPort?: number;
  identityFile?: string;
  keepalive?: boolean;
};

export type OpenDbTunnelResult = {
  localHost: string;
  localPort: number;
  remoteHost: string;
  resolutionMethod: "getent" | "docker_inspect";
  sshArgs: string[];
  child: ReturnType<typeof openSshTunnel>;
  tunnelPlan: DatabaseAccessPlan;
};

export async function openDatabaseTunnel(
  input: OpenDbTunnelInput,
): Promise<OpenDbTunnelResult> {
  const plan = input.plan;
  if (!plan.capabilities.tunnel) {
    throw new Error("Database tunnel is not supported for this project mode.");
  }
  if (!plan.tunnel.sshHost.trim()) {
    throw new Error(
      "SSH host is not configured. Set FLUX_DB_TUNNEL_SSH_HOST or DOCKER_HOST=ssh://user@host before opening a tunnel.",
    );
  }

  const localHost = input.localHost.trim() || plan.tunnel.recommendedLocalHost;
  const requestedPort = input.localPort ?? DEFAULT_DB_TUNNEL_LOCAL_PORT;
  const localPort = await resolveLocalTunnelPort({
    host: localHost,
    requestedPort,
    strictPort: input.strictPort === true,
  });

  const resolution = await resolveRemoteTunnelTarget({
    sshHost: plan.tunnel.sshHost,
    sshUser: plan.tunnel.sshUser,
    sshPort: plan.tunnel.sshPort,
    internalHost: plan.database.internalHost,
    ...(plan.mode === "v1_dedicated"
      ? { containerName: plan.database.containerName }
      : plan.database.containerName
        ? { containerName: plan.database.containerName }
        : {}),
    ...(input.identityFile ? { identityFile: input.identityFile } : {}),
    ...(input.keepalive === true ? { keepalive: true } : {}),
  });

  if (!resolution.ok) {
    const detail = resolution.diagnostics.join(" ");
    throw new Error(`${resolution.message}${detail ? ` ${detail}` : ""}`);
  }

  const tunnelPlan: DatabaseAccessPlan = {
    ...plan,
    tunnel: {
      ...plan.tunnel,
      recommendedLocalHost: localHost as "127.0.0.1",
      recommendedLocalPort: localPort,
    },
  };

  const sshArgs = buildSshTunnelArgs({
    localHost,
    localPort,
    remoteHost: resolution.remoteHost,
    remotePort: plan.database.internalPort,
    sshHost: plan.tunnel.sshHost,
    sshUser: plan.tunnel.sshUser,
    sshPort: plan.tunnel.sshPort,
    ...(input.identityFile ? { identityFile: input.identityFile } : {}),
    ...(input.keepalive === true ? { keepalive: true } : {}),
  });

  const child = openSshTunnel(sshArgs);
  await waitForLocalPortAccepting({ host: localHost, port: localPort });
  return {
    localHost,
    localPort,
    remoteHost: resolution.remoteHost,
    resolutionMethod: resolution.method,
    sshArgs,
    child,
    tunnelPlan,
  };
}

export function parsePostgresPasswordFromConnectionString(
  connectionString: string,
): string {
  const normalized = connectionString.startsWith("postgres://")
    ? `postgresql://${connectionString.slice("postgres://".length)}`
    : connectionString;
  const url = new URL(normalized);
  return decodeURIComponent(url.password);
}

export function buildPsqlEnv(auth: DbConnectionAuth): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (auth.mode === "v1_dedicated") {
    env.PGPASSWORD = auth.password;
    return env;
  }
  env.PGPASSWORD = auth.credential.password;
  env.PGOPTIONS = `-c search_path=${auth.credential.searchPath.join(",")}`;
  return env;
}

export function resolveDbAccessLevel(input: {
  readonly?: boolean;
  readwrite?: boolean;
  plan: DatabaseAccessPlan;
}): DbAccessLevel {
  if (input.readwrite && input.readonly) {
    throw new Error("Choose only one of --readonly or --readwrite.");
  }
  if (input.readwrite) {
    if (input.plan.mode === "v2_shared" && !input.plan.capabilities.readwrite) {
      throw new Error(
        "Read/write database access is disabled on this platform. Omit --readwrite or ask an operator to enable FLUX_DB_ACCESS_ALLOW_READWRITE.",
      );
    }
    return "readwrite";
  }
  return "readonly";
}

export function pgDumpTenantSchemaArgs(input: {
  localHost: string;
  localPort: number;
  username: string;
  tenantSchema: string;
  schemaOnly?: boolean;
}): string[] {
  return [
    "-h",
    input.localHost,
    "-p",
    String(input.localPort),
    "-U",
    input.username,
    "-d",
    "postgres",
    "--schema",
    input.tenantSchema,
    "--no-owner",
    "--no-acl",
    ...(input.schemaOnly === true ? ["--schema-only"] : []),
    "--format",
    "custom",
  ];
}

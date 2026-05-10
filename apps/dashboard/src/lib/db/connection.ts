import type { ProjectManager } from "@flux/core";
import net from "node:net";

/** Bind address used by {@link FLUX_SYSTEM_POSTGRES_PUBLISH_PORT} in @flux/core (host-run dashboard). */
export const FLUX_SYSTEM_PG_HOST_BIND = "127.0.0.1";

/**
 * When Next.js runs on the host, Docker DNS names for `flux-system-db` do not resolve. If
 * `FLUX_SYSTEM_POSTGRES_PUBLISH_PORT` is set, core maps that port on `127.0.0.1` → container 5432;
 * rewrite the internal URI so `pg` connects from the host.
 */
export function systemDatabaseUrlForHostProcess(
  internalPostgresUri: string,
  hostPublishPort: string,
): string {
  const raw = internalPostgresUri.startsWith("postgres://")
    ? `postgresql://${internalPostgresUri.slice("postgres://".length)}`
    : internalPostgresUri;
  const u = new URL(raw);
  u.hostname = FLUX_SYSTEM_PG_HOST_BIND;
  u.port = hostPublishPort;
  return u.toString();
}

export async function resolveSystemDatabaseConnectionString(
  pm: ProjectManager,
  systemHash: string,
): Promise<string> {
  const explicit = process.env.FLUX_SYSTEM_DATABASE_URL?.trim();
  if (explicit) return explicit;

  const internal = await pm.getPostgresHostConnectionString(
    "flux-system",
    systemHash,
  );
  const publishPort = process.env.FLUX_SYSTEM_POSTGRES_PUBLISH_PORT?.trim();
  if (publishPort) {
    return systemDatabaseUrlForHostProcess(internal, publishPort);
  }
  return internal;
}

/** Host-run dashboard: after provision, the published 5432→host port can lag behind in-container readiness. */
export function loopbackTargetFromPostgresUrl(
  connectionString: string,
): { host: string; port: number } | null {
  const raw = connectionString.startsWith("postgres://")
    ? `postgresql://${connectionString.slice("postgres://".length)}`
    : connectionString;
  try {
    const u = new URL(raw);
    const port = u.port ? Number(u.port) : 5432;
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
      return null;
    }
    if (!Number.isFinite(port) || port <= 0) return null;
    return { host: "127.0.0.1", port };
  } catch {
    return null;
  }
}

export function waitForTcpPort(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const socket = net.createConnection({ host, port }, () => {
        socket.end();
        resolve();
      });
      socket.setTimeout(1500);
      const fail = (): void => {
        socket.removeAllListeners();
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(
            new Error(
              `Timed out after ${timeoutMs}ms waiting for ${host}:${port} (flux-system Postgres + FLUX_SYSTEM_POSTGRES_PUBLISH_PORT?)`,
            ),
          );
        } else {
          setTimeout(attempt, 300);
        }
      };
      socket.on("error", fail);
      socket.on("timeout", fail);
    };
    attempt();
  });
}

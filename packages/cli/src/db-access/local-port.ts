import net from "node:net";

export const DEFAULT_DB_TUNNEL_LOCAL_PORT = 15_432;

export function isLocalPortAvailable(
  host: string,
  port: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host, port }, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function resolveLocalTunnelPort(input: {
  host: string;
  requestedPort: number;
  strictPort: boolean;
}): Promise<number> {
  if (input.strictPort) {
    const free = await isLocalPortAvailable(input.host, input.requestedPort);
    if (!free) {
      throw new Error(
        `Local port ${String(input.requestedPort)} on ${input.host} is already in use. ` +
          "Choose another port or omit --strict-port to auto-increment.",
      );
    }
    return input.requestedPort;
  }

  for (let offset = 0; offset < 100; offset += 1) {
    const candidate = input.requestedPort + offset;
    if (await isLocalPortAvailable(input.host, candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `Could not find a free local port starting at ${String(input.requestedPort)} on ${input.host}.`,
  );
}

export async function waitForLocalPortAccepting(input: {
  host: string;
  port: number;
  timeoutMs?: number;
}): Promise<void> {
  const timeoutMs = input.timeoutMs ?? 15_000;
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const socket = net.connect({ host: input.host, port: input.port });
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) {
          reject(
            new Error(
              `Timed out waiting for SSH tunnel on ${input.host}:${String(input.port)}.`,
            ),
          );
          return;
        }
        setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

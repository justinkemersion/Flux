import { Redis } from "ioredis";
import { env } from "./env.ts";

let _client: Redis | null = null;

function createClient(): Redis {
  const client = new Redis(env.REDIS_URL!, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    commandTimeout: 400,
    socketTimeout: 400,
    connectTimeout: 400,
    enableReadyCheck: true,
    retryStrategy(times: number) {
      if (times > 2) return null;
      return Math.min(times * 80, 200);
    },
  });
  client.on("error", (err: Error) => {
    console.error("[gateway:redis] client error:", err.message);
  });
  return client;
}

export function getRedis(): Redis | null {
  if (_client === null && env.REDIS_URL) {
    _client = createClient();
  }
  return _client;
}

/**
 * Wraps any Redis call in a try/catch and returns null on failure.
 * This is the only way Redis is accessed in the gateway — it never
 * propagates errors to the request path.
 */
export async function safeRedis<T>(
  fn: (client: Redis) => Promise<T>,
): Promise<T | null> {
  const client = getRedis();
  if (!client) return null;
  try {
    return await fn(client);
  } catch (err) {
    console.error(
      "[gateway:redis] operation failed (fail-open):",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

import { Redis } from "ioredis";
import { env } from "./env.ts";

const POOL_SIZE = 4;
let _pool: Redis[] = [];
let _rrIdx = 0;

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

/**
 * Returns the next Redis client from the round-robin pool.
 *
 * A single ioredis socket tops out at ~50-80k ops/sec.  At 10k rps with
 * ~3-4 Redis ops per request that's ~30-40k ops/sec — fine for one socket
 * in the median case, but a hot tenant can push one socket over its ceiling.
 *
 * Four clients with round-robin spreads the load without the complexity of
 * a full cluster client.  All clients are equivalent (same server, same auth),
 * so there's no consistency risk.
 */
export function getRedis(): Redis | null {
  if (!env.REDIS_URL) return null;
  if (_pool.length === 0) {
    _pool = Array.from({ length: POOL_SIZE }, () => createClient());
  }
  // Simple round-robin; safe for single-threaded Node event loop
  const client = _pool[_rrIdx % POOL_SIZE]!;
  _rrIdx = (_rrIdx + 1) % POOL_SIZE;
  return client;
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

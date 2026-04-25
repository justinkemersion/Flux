import { getRedis } from "./redis.ts";
import { env } from "./env.ts";

/**
 * Acquires a rate-limit slot for the given tenant using a fixed-window counter.
 *
 * Returns true (allowed) or false (limit exceeded).
 * Fail-open: if Redis is unavailable, always returns true.
 *
 * The rare stale-key edge case (process crashes between INCR and EXPIRE) is
 * accepted under the fail-open model for v1 of the gateway. Do not add Lua yet.
 *
 * Key cardinality: currently `rate:<tenantId>` — one bucket per tenant across
 * all routes. Future dimensions to consider when traffic patterns emerge:
 *   rate:<tenantId>:<routePrefix>  — per-endpoint fairness
 *   rate:<apiKeyId>                — per-key billing dimension
 * Avoid premature complexity; add only when one endpoint starves all traffic.
 */
export async function acquireRateSlot(tenantId: string): Promise<boolean> {
  const key = `rate:${tenantId}`;
  const limit: number = env.FLUX_GATEWAY_RATE_LIMIT;
  const windowSec: number = env.FLUX_GATEWAY_RATE_WINDOW_SEC;

  const client = getRedis();
  if (!client) return true; // Redis not configured → fail-open

  try {
    const count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, windowSec);
    }
    return count <= limit;
  } catch {
    // Redis error → fail-open
    return true;
  }
}

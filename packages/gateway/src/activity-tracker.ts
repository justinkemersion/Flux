import { safeRedis } from "./redis.ts";

const ACTIVITY_TTL_SEC = 60;

/**
 * Best-effort activity tracking via Redis INCR.
 * Fire-and-forget: never awaited on the critical request path.
 * Redis down → silently skipped.
 */
export function trackActivity(tenantId: string): void {
  void safeRedis(async (r) => {
    const key = `activity:${tenantId}`;
    const count = await r.incr(key);
    if (count === 1) {
      await r.expire(key, ACTIVITY_TTL_SEC);
    }
    return count;
  });
}

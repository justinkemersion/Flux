import { safeRedis } from "./redis.ts";

const ACTIVITY_TTL_SEC = 60;
/**
 * Maximum number of unresolved fire-and-forget activity promises.
 * Without this guard, a stalled Redis under load accumulates unbounded
 * Promises in the event loop queue, growing memory until the process OOMs.
 * Dropping observations above the threshold is acceptable — activity tracking
 * is observability, not correctness.
 */
const MAX_INFLIGHT_ACTIVITY = 1_000;
let _inflight = 0;

/**
 * Best-effort activity tracking via Redis INCR.
 * Fire-and-forget: never awaited on the critical request path.
 * Redis down or backpressure limit reached → silently skipped.
 */
export function trackActivity(tenantId: string): void {
  if (_inflight >= MAX_INFLIGHT_ACTIVITY) return;
  _inflight++;
  void safeRedis(async (r) => {
    const key = `activity:${tenantId}`;
    const count = await r.incr(key);
    if (count === 1) {
      await r.expire(key, ACTIVITY_TTL_SEC);
    }
    return count;
  }).finally(() => {
    _inflight--;
  });
}

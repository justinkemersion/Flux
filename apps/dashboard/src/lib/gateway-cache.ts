/**
 * Best-effort gateway cache eviction for hostname resolution keys.
 *
 * The @flux/gateway caches hostname → tenant mappings in Redis under the key
 * `hostname:<normalised-host>`.  Any CRUD operation that changes the mapping
 * (domain add, domain delete, project delete) MUST call evictHostname so that
 * the gateway stops routing traffic to the old (or deleted) tenant.
 *
 * Fail-open contract: Redis unavailability must never block a DB write.
 * The DB is always the source of truth; the cache is a performance optimisation.
 * On eviction failure the stale cache entry expires within REDIS_CACHE_TTL_SEC
 * (60 s by default) — "zombie routing" window is bounded.
 */

import { fluxApiUrlForV2Shared, fluxTenantV1LegacyDottedHostname } from "@flux/core";

/**
 * Normalised hostnames to DEL for v2_shared: current flat `api--` ingress shape plus
 * legacy dot `api.` keys from before URL flattening (deduped if identical).
 */
export function v2SharedGatewayCacheHostnames(
  slug: string,
  hash: string,
  isProduction: boolean,
): string[] {
  const flat = new URL(
    fluxApiUrlForV2Shared(slug, hash, isProduction),
  ).hostname.toLowerCase();
  const legacy = fluxTenantV1LegacyDottedHostname(slug, hash).toLowerCase();
  return flat === legacy ? [flat] : [flat, legacy];
}

function getRedisUrl(): string | undefined {
  return process.env.FLUX_REDIS_URL?.trim() || process.env.REDIS_URL?.trim() || undefined;
}

/**
 * Evicts a single normalised hostname from the gateway Redis cache.
 * Silently no-ops when Redis is not configured (FLUX_REDIS_URL / REDIS_URL unset).
 */
export async function evictHostname(hostname: string): Promise<void> {
  const redisUrl = getRedisUrl();
  if (!redisUrl) return;
  try {
    const Redis = (await import("ioredis")).default;
    const client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1500,
    });
    try {
      await client.connect();
      await client.del(`hostname:${hostname}`);
    } finally {
      client.disconnect();
    }
  } catch {
    // Fail-open: cache eviction failures must not block domain or project operations.
  }
}

/**
 * Bulk-evicts a list of hostnames from the gateway Redis cache in a single
 * connection.  Prefers a single DEL command with multiple keys over N round-trips.
 * Silently no-ops when the list is empty or Redis is not configured.
 */
export async function evictHostnames(hostnames: readonly string[]): Promise<void> {
  if (hostnames.length === 0) return;
  const redisUrl = getRedisUrl();
  if (!redisUrl) return;
  try {
    const Redis = (await import("ioredis")).default;
    const client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1500,
    });
    try {
      await client.connect();
      const keys = hostnames.map((h) => `hostname:${h}`);
      await client.del(...keys);
    } finally {
      client.disconnect();
    }
  } catch {
    // Fail-open.
  }
}

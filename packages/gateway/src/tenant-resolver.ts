import { getPool } from "./db.ts";
import { safeRedis } from "./redis.ts";
import { memGet, memSet, memDel } from "./cache.ts";
import { tenantIdToShortid } from "./shortid.ts";
import { env } from "./env.ts";
import { z } from "zod";
import type { TenantResolution, ProjectMode } from "./types.ts";

export type { TenantResolution, ProjectMode };

/** Where in the lookup chain the tenant resolution was satisfied. */
export type CacheSource = "memory" | "redis" | "db" | null;

export interface ResolvedTenant {
  resolution: TenantResolution;
  /** How the resolution was satisfied — useful for structured logs and latency analysis. */
  cacheSource: CacheSource;
}

const REDIS_CACHE_TTL_SEC = 300;

/**
 * Zod schema for values stored in the Redis tenant-resolution cache.
 * Validates on read to prevent a compromised Redis instance from injecting
 * a crafted TenantResolution that routes one tenant's traffic to another.
 */
const tenantResolutionSchema = z.object({
  projectId: z.string().uuid(),
  tenantId: z.string().uuid(),
  shortid: z.string().min(1),
  mode: z.enum(["v1_dedicated", "v2_shared"]),
  slug: z.string().min(1),
});

/**
 * Normalizes a raw Host header value for use as a cache key and DB lookup.
 * Lowercases and strips the port if present.
 */
export function normalizeHost(raw: string): string {
  return raw.toLowerCase().split(":")[0]!;
}

/**
 * Resolves a normalized hostname to a ResolvedTenant.
 *
 * Resolution order (per architecture spec):
 *  1. In-memory cache (TTL 8s) — protects against Redis-down DB hammering.
 *  2. Redis cache key `hostname:<normalizedHost>` (TTL 5m).
 *  3. DB: exact match in `domains` table — covers all custom domains (apex, www, etc.).
 *  4. DB: subdomain slug fallback — only when host ends with FLUX_BASE_DOMAIN.
 *     Extracts first label as slug, queries `projects` table.
 *  5. Returns null → caller responds 404.
 *
 * Cache invalidation: domain CRUD operations MUST call evictHostname(hostname)
 * to evict both memory and Redis to prevent stale routing.
 *
 * Stale-routing window: after a domain update + Redis eviction, in-memory
 * cache may still serve the old resolution for up to 8s. This is acceptable
 * by design — the window is bounded and the fail-open model is preferred over
 * a synchronous cross-process cache flush.
 */
export async function resolveTenant(
  rawHost: string,
): Promise<ResolvedTenant | null> {
  const host = normalizeHost(rawHost);
  const cacheKey = `hostname:${host}`;

  // 1. In-memory cache
  const mem = memGet(cacheKey);
  if (mem) return { resolution: mem, cacheSource: "memory" };

  // 2. Redis cache
  const cached = await safeRedis((r) => r.get(cacheKey));
  if (cached) {
    try {
      const result = tenantResolutionSchema.safeParse(JSON.parse(cached));
      if (result.success) {
        memSet(cacheKey, result.data);
        return { resolution: result.data, cacheSource: "redis" };
      }
      // Malformed or tampered cache entry — evict and fall through to DB.
      console.warn("[gateway] Redis cache entry failed schema validation; evicting:", cacheKey);
      await safeRedis((r) => r.del(cacheKey));
    } catch {
      // JSON.parse failure — fall through to DB
    }
  }

  // 3. Exact match in domains table (custom domains, including apex + www)
  const domainRow = await queryByExactDomain(host);
  if (domainRow) {
    await cacheResolution(cacheKey, domainRow);
    return { resolution: domainRow, cacheSource: "db" };
  }

  // 4. Subdomain slug fallback — only for Flux-managed subdomains
  const baseDomain = env.FLUX_BASE_DOMAIN.toLowerCase();
  if (host !== baseDomain && host.endsWith(`.${baseDomain}`)) {
    const prefix = host.slice(0, host.length - baseDomain.length - 1);
    // Subdomain format: <slug>-<hash> (e.g. myapp-a1b2c3d.flux.localhost).
    // The 7-hex hash is globally unique per project, so the lookup is fully
    // deterministic even when two users share the same slug.
    // Only the first label is used — nested subdomains are ignored.
    const label = prefix.split(".")[0] ?? "";
    const lastDash = label.lastIndexOf("-");
    if (lastDash > 0) {
      const slug = label.slice(0, lastDash);
      const hash = label.slice(lastDash + 1);
      if (slug && hash) {
        const slugRow = await queryBySlugAndHash(slug, hash);
        if (slugRow) {
          await cacheResolution(cacheKey, slugRow);
          return { resolution: slugRow, cacheSource: "db" };
        }
      }
    }
  }

  return null;
}

/**
 * Evicts a hostname from both the in-memory and Redis caches.
 * Call this from every domain create / update / delete operation.
 * For rename operations, evict both old and new hostname.
 */
export async function evictHostname(rawHost: string): Promise<void> {
  const host = normalizeHost(rawHost);
  const key = `hostname:${host}`;
  memDel(key);
  await safeRedis((r) => r.del(key));
}

async function cacheResolution(
  key: string,
  resolution: TenantResolution,
): Promise<void> {
  memSet(key, resolution);
  await safeRedis((r) =>
    r.set(key, JSON.stringify(resolution), "EX", REDIS_CACHE_TTL_SEC),
  );
}

async function queryByExactDomain(
  hostname: string,
): Promise<TenantResolution | null> {
  const { rows } = await getPool().query<{
    project_id: string;
    tenant_id: string;
    slug: string;
    mode: string;
  }>(
    `SELECT d.project_id,
            p.id   AS tenant_id,
            p.slug,
            p.mode
     FROM   domains d
     JOIN   projects p ON p.id = d.project_id
     WHERE  d.hostname = $1
     LIMIT  1`,
    [hostname],
  );
  const row = rows[0];
  if (!row) return null;
  return toResolution(row.tenant_id, row.project_id, row.slug, row.mode);
}

async function queryBySlugAndHash(
  slug: string,
  hash: string,
): Promise<TenantResolution | null> {
  const { rows } = await getPool().query<{
    id: string;
    slug: string;
    mode: string;
  }>(
    // Filter by both slug AND hash so the lookup is deterministic regardless
    // of how many users share the same slug across the platform.
    `SELECT id, slug, mode
     FROM   projects
     WHERE  slug = $1
       AND  hash = $2
     LIMIT  1`,
    [slug, hash],
  );
  const row = rows[0];
  if (!row) return null;
  return toResolution(row.id, row.id, row.slug, row.mode);
}

function toResolution(
  tenantId: string,
  projectId: string,
  slug: string,
  mode: string,
): TenantResolution {
  return {
    tenantId,
    projectId,
    shortid: tenantIdToShortid(tenantId),
    mode: mode as ProjectMode,
    slug,
  };
}

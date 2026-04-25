import { getPool } from "./db.ts";
import { safeRedis } from "./redis.ts";
import { memGet, memSet, memDel } from "./cache.ts";
import { tenantIdToShortid } from "./shortid.ts";
import { env } from "./env.ts";
import type { TenantResolution, ProjectMode } from "./types.ts";

export type { TenantResolution, ProjectMode };

const REDIS_CACHE_TTL_SEC = 300;

/**
 * Normalizes a raw Host header value for use as a cache key and DB lookup.
 * Lowercases and strips the port if present.
 */
export function normalizeHost(raw: string): string {
  return raw.toLowerCase().split(":")[0]!;
}

/**
 * Resolves a normalized hostname to a TenantResolution.
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
 */
export async function resolveTenant(
  rawHost: string,
): Promise<TenantResolution | null> {
  const host = normalizeHost(rawHost);
  const cacheKey = `hostname:${host}`;

  // 1. In-memory cache
  const mem = memGet(cacheKey);
  if (mem) return mem;

  // 2. Redis cache
  const cached = await safeRedis((r) => r.get(cacheKey));
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as TenantResolution;
      memSet(cacheKey, parsed);
      return parsed;
    } catch {
      // malformed cache entry — fall through to DB
    }
  }

  // 3. Exact match in domains table (custom domains, including apex + www)
  const domainRow = await queryByExactDomain(host);
  if (domainRow) {
    await cacheResolution(cacheKey, domainRow);
    return domainRow;
  }

  // 4. Subdomain slug fallback — only for Flux-managed subdomains
  const baseDomain = env.FLUX_BASE_DOMAIN.toLowerCase();
  if (host !== baseDomain && host.endsWith(`.${baseDomain}`)) {
    const prefix = host.slice(0, host.length - baseDomain.length - 1);
    // Only use the first label — ignore nested subdomains
    const slug = prefix.split(".")[0];
    if (slug) {
      const slugRow = await queryBySlug(slug);
      if (slugRow) {
        await cacheResolution(cacheKey, slugRow);
        return slugRow;
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

async function queryBySlug(slug: string): Promise<TenantResolution | null> {
  const { rows } = await getPool().query<{
    id: string;
    slug: string;
    mode: string;
  }>(
    `SELECT id, slug, mode
     FROM   projects
     WHERE  slug = $1
     LIMIT  1`,
    [slug],
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

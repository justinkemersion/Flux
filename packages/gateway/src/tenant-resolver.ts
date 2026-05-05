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

const REDIS_CACHE_TTL_SEC = 60;

/**
 * In-flight deduplication map (single-flight pattern).
 *
 * When N concurrent requests arrive for the same uncached hostname they all
 * race to the resolver.  Without coalescing each one would issue its own DB
 * query, producing a stampede that (a) floods the pg pool, (b) amplifies under
 * Redis outages, and (c) causes the thundering-herd on cold deploy.
 *
 * With coalescing: the first request creates the Promise and inserts it here;
 * subsequent requests return the same Promise.  One DB round-trip fans out to
 * all waiters.  The entry is removed when the Promise settles (success or error)
 * so the next request after a miss gets a fresh lookup rather than a stale one.
 */
const inflight = new Map<string, Promise<ResolvedTenant | null>>();

/**
 * Zod schema for values stored in the Redis tenant-resolution cache.
 * Validates on read to prevent a compromised Redis instance from injecting
 * a crafted TenantResolution that routes one tenant's traffic to another.
 */
/** Redis payload — intentionally omits jwtSecret (see cacheResolution). */
const tenantResolutionSchema = z.object({
  projectId: z.string().uuid(),
  tenantId: z.string().uuid(),
  shortid: z.string().min(1),
  mode: z.enum(["v1_dedicated", "v2_shared"]),
  slug: z.string().min(1),
  migrationStatus: z.string().nullable().optional(),
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
 *  1. In-memory cache (TTL 60s) — protects against Redis-down DB hammering.
 *  2. Redis cache key `hostname:<normalizedHost>` (TTL 60s).
 *  3. DB: exact match in `domains` table — covers all custom domains (apex, www, etc.).
 *  4. DB: Flux subdomain fallbacks when host ends with FLUX_BASE_DOMAIN:
 *     a) v2_shared ingress shape `api--<slug>--<7-hex-hash>.<base>` (single DNS label).
 *     b) v1_dedicated Traefik shape `api.<slug>.<7-hex-hash>.<base>` (@flux/core
 *        fluxTenantPostgrestHostname default prefix `api`).
 *     c) Legacy / dev single-label `<slug>-<hash>.<base>` (first label only).
 *     All query `projects` by slug + hash.
 *  5. Returns null → caller responds 404.
 *
 * Cache invalidation: domain CRUD operations MUST call evictHostname(hostname)
 * to evict both memory and Redis to prevent stale routing.
 *
 * Stale-routing window: after a domain update + Redis eviction, in-memory
 * cache may still serve the old resolution for up to 60s. This is acceptable
 * by design — the window is bounded and the fail-open model is preferred over
 * a synchronous cross-process cache flush.
 */
export async function resolveTenant(
  rawHost: string,
): Promise<ResolvedTenant | null> {
  const host = normalizeHost(rawHost);

  // In-memory hit — no coalescing needed, no async work at all.
  const mem = memGet(`hostname:${host}`);
  if (mem) return { resolution: mem, cacheSource: "memory" };

  // Single-flight: collapse concurrent misses for the same host into one lookup.
  const existing = inflight.get(host);
  if (existing) return existing;

  const p = resolveUncached(host).finally(() => inflight.delete(host));
  inflight.set(host, p);
  return p;
}

/**
 * The actual multi-layer lookup.  Only called when the in-memory cache misses
 * and no in-flight promise exists for this hostname.
 */
async function resolveUncached(host: string): Promise<ResolvedTenant | null> {
  const cacheKey = `hostname:${host}`;

  // 2. Redis cache
  const cached = await safeRedis((r) => r.get(cacheKey));
  if (cached) {
    try {
      const result = tenantResolutionSchema.safeParse(JSON.parse(cached));
      if (result.success) {
        const resolution: TenantResolution = {
          ...result.data,
          jwtSecret: null,
          migrationStatus: result.data.migrationStatus ?? null,
        };
        memSet(cacheKey, resolution);
        return { resolution, cacheSource: "redis" };
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

  // 4. Subdomain slug fallbacks — only for Flux-managed subdomains
  const baseDomain = env.FLUX_BASE_DOMAIN.toLowerCase();
  if (host !== baseDomain && host.endsWith(`.${baseDomain}`)) {
    const prefix = host.slice(0, host.length - baseDomain.length - 1);
    const parts = prefix.split(".");
    const HASH_HEX_LEN = 7;
    const hashHexRe = new RegExp(`^[0-9a-f]{${HASH_HEX_LEN}}$`, "i");

    // 4a-flat. Single label: api--<slug>--<hash>.<base> (v2_shared gateway ingress).
    if (parts.length === 1) {
      const label = parts[0] ?? "";
      if (label.toLowerCase().startsWith("api--")) {
        const segs = label.split("--");
        if (
          segs.length >= 3 &&
          segs[0]!.toLowerCase() === "api"
        ) {
          const hashPart = segs[segs.length - 1]!.toLowerCase();
          if (hashHexRe.test(hashPart)) {
            const slug = segs.slice(1, -1).join("--");
            if (slug) {
              const slugRow = await queryBySlugAndHash(slug, hashPart);
              if (slugRow) {
                await cacheResolution(cacheKey, slugRow);
                return { resolution: slugRow, cacheSource: "db" };
              }
            }
          }
        }
      }
    }

    // 4b-dot. Traefik v1: api.<slug>.<hash>.<base> → prefix is three labels.
    const hashPart = parts[2]?.toLowerCase() ?? "";
    if (
      parts.length === 3 &&
      parts[0]!.toLowerCase() === "api" &&
      hashHexRe.test(hashPart)
    ) {
      const slug = parts[1]!;
      const slugRow = await queryBySlugAndHash(slug, hashPart);
      if (slugRow) {
        await cacheResolution(cacheKey, slugRow);
        return { resolution: slugRow, cacheSource: "db" };
      }
    }
    // 4c. Legacy single-label: <slug>-<hash>.<base> (e.g. myapp-a1b2c3d.flux.localhost).
    const label = parts[0] ?? "";
    const lastDash = label.lastIndexOf("-");
    if (lastDash > 0) {
      const slug = label.slice(0, lastDash);
      const hash = label.slice(lastDash + 1).toLowerCase();
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
  const { jwtSecret: _omit, ...forRedis } = resolution;
  await safeRedis((r) =>
    r.set(key, JSON.stringify(forRedis), "EX", REDIS_CACHE_TTL_SEC),
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
    jwt_secret: string | null;
    migration_status: string | null;
  }>(
    `SELECT d.project_id,
            p.id   AS tenant_id,
            p.slug,
            p.mode,
            p.jwt_secret,
            p.migration_status
     FROM   domains d
     JOIN   projects p ON p.id = d.project_id
     WHERE  d.hostname = $1
     LIMIT  1`,
    [hostname],
  );
  const row = rows[0];
  if (!row) return null;
  return toResolution(
    row.tenant_id,
    row.project_id,
    row.slug,
    row.mode,
    row.jwt_secret,
    row.migration_status,
  );
}

async function queryBySlugAndHash(
  slug: string,
  hash: string,
): Promise<TenantResolution | null> {
  const { rows } = await getPool().query<{
    id: string;
    slug: string;
    mode: string;
    jwt_secret: string | null;
    migration_status: string | null;
  }>(
    // Filter by both slug AND hash so the lookup is deterministic regardless
    // of how many users share the same slug across the platform.
    `SELECT id, slug, mode, jwt_secret, migration_status
     FROM   projects
     WHERE  slug = $1
       AND  hash = $2
     LIMIT  1`,
    [slug, hash],
  );
  const row = rows[0];
  if (!row) return null;
  return toResolution(
    row.id,
    row.id,
    row.slug,
    row.mode,
    row.jwt_secret,
    row.migration_status,
  );
}

function toResolution(
  tenantId: string,
  projectId: string,
  slug: string,
  mode: string,
  jwtSecret: string | null,
  migrationStatus: string | null,
): TenantResolution {
  return {
    tenantId,
    projectId,
    shortid: tenantIdToShortid(tenantId),
    mode: mode as ProjectMode,
    slug,
    jwtSecret,
    migrationStatus,
  };
}

/**
 * Loads jwt_secret when the hostname cache layer omitted it (Redis / legacy rows).
 */
export async function fetchProjectJwtSecret(
  projectId: string,
): Promise<string | null> {
  const { rows } = await getPool().query<{ jwt_secret: string | null }>(
    `SELECT jwt_secret FROM projects WHERE id = $1 LIMIT 1`,
    [projectId],
  );
  return rows[0]?.jwt_secret ?? null;
}

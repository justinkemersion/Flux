import type { TenantResolution } from "./types.ts";

interface CacheEntry {
  value: TenantResolution;
  expiresAt: number;
}

/**
 * In-memory tenant resolution cache.
 *
 * TTL: each memSet resets the expiry clock (no stale-extension risk).
 *
 * Unbounded growth note: the store is a plain Map. In typical deployments
 * (hundreds to low-thousands of tenants) this is negligible. If the tenant
 * count grows into the tens of thousands, add an LRU eviction with a size
 * cap (e.g. 10_000 entries ≈ ~2 MB) and a scheduled sweep.
 */
const TTL_MS = 8_000;
const store = new Map<string, CacheEntry>();

export function memGet(key: string): TenantResolution | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

/** TTL is always reset to now + TTL_MS on every set. */
export function memSet(key: string, value: TenantResolution): void {
  store.set(key, { value, expiresAt: Date.now() + TTL_MS });
}

export function memDel(key: string): void {
  store.delete(key);
}

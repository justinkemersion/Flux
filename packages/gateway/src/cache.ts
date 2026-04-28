import type { TenantResolution } from "./types.ts";

interface CacheEntry {
  value: TenantResolution;
  expiresAt: number;
}

const TTL_MS = 60_000;
/**
 * Maximum number of entries before LRU eviction kicks in.
 *
 * 10k entries × ~400 bytes (UUID strings + mode + slug) ≈ 4 MB.
 * Appropriate for a single-process gateway serving tens-of-thousands of tenants.
 * Raise or lower depending on fleet size and available memory.
 */
const MAX_SIZE = 10_000;

/**
 * In-memory LRU tenant resolution cache.
 *
 * Uses a plain Map, which preserves insertion order in V8.  On access,
 * the entry is deleted and re-inserted to move it to the "most recent" end.
 * On set, if the Map is at capacity the oldest entry (first key) is evicted.
 *
 * Complexity: O(1) get, O(1) set, O(1) eviction.
 * No external dependency — Map iteration order is guaranteed by the spec.
 */
const store = new Map<string, CacheEntry>();

export function memGet(key: string): TenantResolution | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  // Refresh position (LRU: move to end)
  store.delete(key);
  store.set(key, entry);
  return entry.value;
}

/** TTL is always reset to now + TTL_MS on every set. */
export function memSet(key: string, value: TenantResolution): void {
  if (store.has(key)) {
    store.delete(key); // refresh position
  } else if (store.size >= MAX_SIZE) {
    // Evict least-recently-used entry (first key in insertion order)
    store.delete(store.keys().next().value!);
  }
  store.set(key, { value, expiresAt: Date.now() + TTL_MS });
}

export function memDel(key: string): void {
  store.delete(key);
}

import type { TenantResolution } from "./types.ts";

interface CacheEntry {
  value: TenantResolution;
  expiresAt: number;
}

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

export function memSet(key: string, value: TenantResolution): void {
  store.set(key, { value, expiresAt: Date.now() + TTL_MS });
}

export function memDel(key: string): void {
  store.delete(key);
}

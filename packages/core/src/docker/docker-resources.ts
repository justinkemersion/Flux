/** Production default: Docker only accepts `MaximumRetryCount` with `on-failure`; use plain `unless-stopped` for tenant stacks. */
export const FLUX_TENANT_RESTART_POLICY = {
  Name: "unless-stopped" as const,
};

const FLUX_TENANT_DEFAULT_MEMORY_BYTES = 256 * 1024 * 1024;
/** 0.5 vCPU for each of DB and API (tunable; stack uses ~1 core under full load on both). */
const FLUX_TENANT_DEFAULT_NANOCPUS = 500_000_000;

/**
 * Per-tenant memory reservation (cgroup soft hint) and default cap (bytes), default 256 MiB.
 * Override with `FLUX_TENANT_MEMORY_BYTES` (decimal integer). Used for both `MemoryReservation`
 * and `Memory` on tenant containers unless the container already has stricter inspect values.
 */
export function fluxTenantMemoryLimitBytes(): number {
  const raw = process.env.FLUX_TENANT_MEMORY_BYTES?.trim();
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return FLUX_TENANT_DEFAULT_MEMORY_BYTES;
}

/**
 * Per-container CPU cap in nanoseconds per CPU per second, default 0.5 vCPU. Override with
 * `FLUX_TENANT_CPU` as a positive decimal (e.g. `0.5`); converted with `round(cpu * 1e9)`.
 */
export function fluxTenantCpuNanoCpus(): number {
  const raw = process.env.FLUX_TENANT_CPU?.trim();
  if (raw) {
    const f = Number.parseFloat(raw);
    if (Number.isFinite(f) && f > 0) {
      return Math.max(1, Math.round(f * 1_000_000_000));
    }
  }
  return FLUX_TENANT_DEFAULT_NANOCPUS;
}

export function tenantStackHostMemoryConfig(): {
  Memory: number;
  MemoryReservation: number;
} {
  const b = fluxTenantMemoryLimitBytes();
  return { Memory: b, MemoryReservation: b };
}

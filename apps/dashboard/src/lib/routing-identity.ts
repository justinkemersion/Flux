import {
  type FluxCatalogProjectMode,
  fluxTenantPostgrestHostname,
  fluxTenantV2SharedHostname,
} from "@flux/core";

/**
 * Deterministic 8-char hex segment for spec table [IDENTITY] column (Traefik-style).
 */
export function hashSegment(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) {
    h = Math.imul(31, h) + key.charCodeAt(i) | 0;
  }
  return Math.abs(h).toString(16).padStart(8, "0").slice(0, 8);
}

/**
 * Spec-table style hostname when `apiUrl` is absent. `v2_shared` uses flat ingress shape;
 * `v1_dedicated` or omitted (legacy list rows) uses dot-separated dedicated PostgREST host.
 */
export function projectApiInterface(
  slug: string,
  hash: string,
  mode?: FluxCatalogProjectMode,
): string {
  if (mode === "v2_shared") {
    return fluxTenantV2SharedHostname(slug, hash);
  }
  return fluxTenantPostgrestHostname(slug, hash);
}

export function uptimeReadoutForStatus(
  status: "running" | "stopped" | "partial" | "missing" | "corrupted",
): string {
  switch (status) {
    case "running":
      return "99.98%";
    case "stopped":
      return "STANDBY";
    case "partial":
      return "PARTIAL";
    case "missing":
      return "MISSING";
    case "corrupted":
      return "DRIFT";
    default: {
      const _e: never = status;
      return _e;
    }
  }
}

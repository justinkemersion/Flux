/**
 * Derives a deterministic short identifier from a tenant UUID.
 *
 * Keep this implementation local to @flux/gateway to avoid runtime coupling to
 * @flux/core source-path exports inside production container images.
 *
 * Algorithm: strip hyphens, take the first 12 hex chars.
 * Collision probability is ~1/2^48 (negligible for realistic tenant counts).
 */
export function tenantIdToShortid(tenantId: string): string {
  return tenantId.replace(/-/g, "").slice(0, 12).toLowerCase();
}

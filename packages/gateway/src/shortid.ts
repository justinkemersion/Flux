/**
 * Derives a deterministic short identifier from a tenant UUID.
 *
 * Algorithm: strip hyphens from the UUID, take the first 12 hex characters.
 * This gives a collision probability of ~1/2^48 — negligible for any
 * realistic number of tenants.
 *
 * Used for Postgres schema names (`t_<shortid>_api`) and role names
 * (`t_<shortid>_role`). Slug is never embedded in these identifiers.
 *
 * Example:
 *   "550e8400-e29b-41d4-a716-446655440000" → "550e8400e29b"
 */
export function tenantIdToShortid(tenantId: string): string {
  return tenantId.replace(/-/g, "").slice(0, 12).toLowerCase();
}

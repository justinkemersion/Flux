/**
 * Derives a deterministic short identifier from a tenant UUID.
 *
 * Canonical implementation lives in @flux/core/standalone (deriveShortId).
 * Re-exported here under the gateway-local name to keep call-sites unchanged
 * while ensuring a single source of truth for the algorithm.
 *
 * Algorithm: strip hyphens, take the first 12 hex chars → ~1/2^48 collision
 * probability, negligible for any realistic tenant count.
 *
 * Example:
 *   "550e8400-e29b-41d4-a716-446655440000" → "550e8400e29b"
 */
export { deriveShortId as tenantIdToShortid } from "@flux/core/standalone";

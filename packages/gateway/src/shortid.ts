/**
 * Derives a deterministic short identifier from a tenant UUID.
 *
 * Same algorithm as `deriveShortId` in `@flux/core/standalone`. PostgREST
 * `Accept-Profile` / `Content-Profile` must use `defaultTenantApiSchemaFromProjectId`
 * from `@flux/core/api-schema-strategy` so profile schema matches the catalog UUID.
 * Gateway JWT `role` must use `defaultTenantRoleFromProjectId` for the same id.
 *
 * Algorithm: strip hyphens, take the first 12 hex chars.
 * Collision probability is ~1/2^48 (negligible for realistic tenant counts).
 */
export function tenantIdToShortid(tenantId: string): string {
  return tenantId.replace(/-/g, "").slice(0, 12).toLowerCase();
}

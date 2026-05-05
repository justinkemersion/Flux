/**
 * Values stored in catalog `projects.migration_status` during v2→v1 migrate.
 *
 * Keep in sync with the dashboard migrate pipeline and gateway drain behavior.
 */

/** Gateway returns 503 for tenant traffic while this status is set (edge cache eviction path). */
export const FLUX_GATEWAY_DRAINING_MIGRATION_STATUS = "migrating" as const;

/**
 * Mutual-exclusion only: same row lock / lease semantics as
 * {@link FLUX_GATEWAY_DRAINING_MIGRATION_STATUS} but the gateway does **not** shed traffic.
 * Used when the operator runs migrate with `noLockWrites` / without draining the edge.
 */
export const FLUX_SILENT_MIGRATION_MUTEX_STATUS = "migrating_no_drain" as const;

export type FluxCatalogMigrationStatus =
  | typeof FLUX_GATEWAY_DRAINING_MIGRATION_STATUS
  | typeof FLUX_SILENT_MIGRATION_MUTEX_STATUS;

export function fluxMigrationStatusIsActiveLease(
  s: string | null | undefined,
): boolean {
  return (
    s === FLUX_GATEWAY_DRAINING_MIGRATION_STATUS ||
    s === FLUX_SILENT_MIGRATION_MUTEX_STATUS
  );
}

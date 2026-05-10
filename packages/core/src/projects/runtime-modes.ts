/**
 * {@link ProjectManager} in `@flux/core` implements the **v1_dedicated** Docker stack (per-tenant
 * Postgres + PostgREST containers). **v2_shared** (pooled Postgres, schema + role isolation) is
 * orchestrated by the control plane / `engine-v2`; call sites should route by catalog `mode` before
 * invoking Docker lifecycle APIs.
 */
export type FluxProjectManagerStackKind = "v1_dedicated";

/** True when catalog `mode` should use Docker stack APIs in `@flux/core` (dedicated containers). */
export function catalogModeUsesDockerStacks(
  mode: string | null | undefined,
): boolean {
  return mode === "v1_dedicated" || mode == null;
}

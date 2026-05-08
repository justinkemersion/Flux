/**
 * User-visible deployment labels for `projects.mode`.
 * Prefer "Pooled" / "Dedicated" over bare "v1" / "v2" so the UI does not read like a version ladder.
 */

export type FluxEngineMode = "v1_dedicated" | "v2_shared";

export function resolveEngineMode(
  mode: FluxEngineMode | undefined | null,
): FluxEngineMode {
  return mode ?? "v1_dedicated";
}

export function engineModeShortLabel(
  mode: FluxEngineMode | undefined | null,
): string {
  return resolveEngineMode(mode) === "v2_shared" ? "Pooled" : "Dedicated";
}

/** Tooltip / title text; includes internal names for support without leading with v1/v2 alone. */
export function engineModeTooltip(
  mode: FluxEngineMode | undefined | null,
): string {
  return resolveEngineMode(mode) === "v2_shared"
    ? "Schema-isolated on shared infrastructure (engine: v2 shared)."
    : "Dedicated Postgres and PostgREST for this project (engine: v1 dedicated).";
}

export function engineModeAriaLabel(
  mode: FluxEngineMode | undefined | null,
): string {
  return `Deployment: ${engineModeShortLabel(mode)}`;
}

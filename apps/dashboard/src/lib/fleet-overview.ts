/**
 * Single-project cell for the Control Room health grid.
 */
export type FleetProjectCell = {
  slug: string;
  name: string;
  /** Coarse health for the rack monitor. */
  health: "running" | "degraded" | "error";
};

/**
 * Map catalog + mesh fields to a tri-state for the overview grid and counts.
 */
export function projectHealthBucket(p: {
  status: string;
  healthStatus: string | null;
}): "running" | "degraded" | "error" {
  if (p.healthStatus === "error") return "error";
  if (p.status === "missing" || p.status === "corrupted") {
    return "error";
  }
  if (p.status === "partial" || p.status === "stopped") {
    return "degraded";
  }
  if (p.status === "running") {
    if (p.healthStatus === "running" || p.healthStatus == null) {
      return "running";
    }
    return "degraded";
  }
  return "degraded";
}

/**
 * v2_shared rows have no per-tenant Docker stack; fleet monitor stores probe
 * results in `projects.health_status` (`running` | `stopped` | `error` | `incomplete`).
 */
export function statusFromV2CatalogHealth(row: {
  healthStatus: string | null;
}): "running" | "stopped" | "partial" {
  if (row.healthStatus === "running") return "running";
  if (row.healthStatus === "stopped") return "stopped";
  if (row.healthStatus === "error" || row.healthStatus === "incomplete") {
    return "partial";
  }
  return "partial";
}

/** UI tri-state for mesh / fleet monitor (client-safe). */
export type FleetTelemetryLevel = "operational" | "stale" | "offline";

/**
 * Emerald only when the last probe reported `running` and the heartbeat is fresh (≤5 min).
 */
export function deriveTelemetryDisplay(
  healthStatus: string | null | undefined,
  lastHeartbeatAt: string | Date | null | undefined,
): FleetTelemetryLevel {
  if (!lastHeartbeatAt) {
    return "offline";
  }
  const t =
    lastHeartbeatAt instanceof Date
      ? lastHeartbeatAt.getTime()
      : new Date(lastHeartbeatAt).getTime();
  if (Number.isNaN(t)) {
    return "offline";
  }
  const age = Date.now() - t;
  const fiveMin = 5 * 60 * 1000;
  if (healthStatus === "running" && age < fiveMin) {
    return "operational";
  }
  if (healthStatus === "running" && age >= fiveMin) {
    return "stale";
  }
  return "offline";
}

export function fleetTelemetryLabel(level: FleetTelemetryLevel): string {
  switch (level) {
    case "operational":
      return "Operational";
    case "stale":
      return "Stale";
    case "offline":
      return "Offline";
    default: {
      const _e: never = level;
      return _e;
    }
  }
}

import type { FluxProjectSummary } from "@flux/core/standalone";

/** Public mesh / control-room mapping (no false "Offline" for brand-new or standby stacks). */
export type FleetTelemetryLevel =
  | "operational"
  | "initializing"
  | "standby"
  | "offline";

export type StackStatusForTelemetry = FluxProjectSummary["status"];

export type DeriveTelemetryInput = {
  healthStatus: string | null | undefined;
  lastHeartbeatAt: string | Date | null | undefined;
  /** When absent, the engine cannot apply the 5m "new project" window (treated as not initializing). */
  createdAt: string | Date | null | undefined;
  /** Docker-observed stack state; drives Standby and overrides stale catalog health. */
  stackStatus: StackStatusForTelemetry | null | undefined;
};

const FIVE_MIN_MS = 5 * 60 * 1000;

function toMs(
  t: string | Date | null | undefined,
): number | null {
  if (t == null) return null;
  const v = t instanceof Date ? t.getTime() : new Date(t).getTime();
  return Number.isNaN(v) ? null : v;
}

/**
 * Deterministic mesh label for UI: Operational / Initializing (neutral) / Standby (dim) / Offline (red).
 * Priority: **Standby** (stack or catalog stopped) → **Initializing** (no probe yet, project &lt; 5m) →
 * **Offline** (probe error, or stale heartbeat) → **Operational** (healthy + fresh).
 */
export function deriveTelemetryDisplay(
  input: DeriveTelemetryInput,
): FleetTelemetryLevel {
  const { healthStatus, lastHeartbeatAt, createdAt, stackStatus } = input;
  const now = Date.now();
  const hbMs = toMs(lastHeartbeatAt);
  const createdMs = toMs(createdAt);
  const isYoungProject =
    createdMs != null && now - createdMs < FIVE_MIN_MS;

  // 1) Standby: user-powered-down stack or explicit catalog flag
  if (
    stackStatus === "stopped" ||
    healthStatus === "stopped"
  ) {
    return "standby";
  }

  // 2) No heartbeat record yet (brand-new or never probed)
  if (hbMs == null) {
    if (isYoungProject) {
      if (stackStatus === "missing" || stackStatus === "corrupted") {
        return "initializing";
      }
      if (stackStatus === "partial") {
        return "offline";
      }
      if (
        stackStatus === "running" ||
        stackStatus == null
      ) {
        return "initializing";
      }
    }
    return "offline";
  }

  const age = now - hbMs;

  // 3) Offline: failed probe, or any heartbeat older than 5m (replaces old "stale" band)
  if (healthStatus === "error" || age > FIVE_MIN_MS) {
    return "offline";
  }

  if (stackStatus != null && stackStatus !== "running" && age <= FIVE_MIN_MS) {
    if (stackStatus === "partial") {
      return "offline";
    }
    if (stackStatus === "missing" || stackStatus === "corrupted") {
      return "offline";
    }
  }

  // 4) Green path
  if (healthStatus === "running" && age <= FIVE_MIN_MS) {
    return "operational";
  }

  // Drift: catalog said running in-window but health not running
  if (healthStatus !== "running" && isYoungProject && (stackStatus == null || stackStatus === "running")) {
    return "initializing";
  }

  return "offline";
}

export function fleetTelemetryLabel(level: FleetTelemetryLevel): string {
  switch (level) {
    case "operational":
      return "Operational";
    case "initializing":
      return "Initializing...";
    case "standby":
      return "Standby";
    case "offline":
      return "Offline";
    default: {
      const _e: never = level;
      return _e;
    }
  }
}

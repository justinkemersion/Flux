import type { FluxProjectSummary } from "@flux/core/standalone";

/** Public mesh / control-room mapping — truth from catalog + Docker, minimal assumptions. */
export type FleetTelemetryLevel =
  | "operational"
  | "initializing"
  | "standby"
  | "offline";

export type StackStatusForTelemetry = FluxProjectSummary["status"];

export type DeriveTelemetryInput = {
  healthStatus: string | null | undefined;
  lastHeartbeatAt: string | Date | null | undefined;
  /** Required for the 5m grace window when `lastHeartbeatAt` is null. */
  createdAt: string | Date | null | undefined;
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
 * **Standby** — `healthStatus === 'stopped'` (catalog) or Docker stack **stopped** (powered down).
 * **Initializing** — no heartbeat yet, project **&lt; 5m** old (grace: no probe result ≠ failure).
 * **Offline (red)** — `healthStatus === 'error'`, or heartbeat **&gt; 5m** old, or no heartbeat and project
 * is **not** in the grace window (and not standby).
 * **Operational** — `healthStatus === 'running'` and last heartbeat **≤ 5m**.
 */
export function deriveTelemetryDisplay(
  input: DeriveTelemetryInput,
): FleetTelemetryLevel {
  const { healthStatus, lastHeartbeatAt, createdAt, stackStatus } = input;
  const now = Date.now();
  const hbMs = toMs(lastHeartbeatAt);
  const createdMs = toMs(createdAt);
  const inGraceWindow =
    createdMs != null && now - createdMs < FIVE_MIN_MS;

  if (healthStatus === "stopped") {
    return "standby";
  }
  if (stackStatus === "stopped") {
    return "standby";
  }

  if (hbMs == null) {
    if (inGraceWindow) {
      return "initializing";
    }
    return "offline";
  }

  const age = now - hbMs;

  if (healthStatus === "error") {
    return "offline";
  }
  if (age > FIVE_MIN_MS) {
    return "offline";
  }

  if (healthStatus === "running" && age <= FIVE_MIN_MS) {
    return "operational";
  }

  if (inGraceWindow) {
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

import {
  type FleetTelemetryLevel,
  deriveTelemetryDisplay,
  fleetTelemetryLabel,
} from "@/src/lib/fleet-telemetry-display";

const dot: Record<FleetTelemetryLevel, string> = {
  operational: "bg-emerald-500",
  stale: "bg-amber-500",
  offline: "bg-red-500",
};

const text: Record<FleetTelemetryLevel, string> = {
  operational:
    "text-emerald-800 dark:text-emerald-200",
  stale: "text-amber-900 dark:text-amber-200",
  offline: "text-red-900 dark:text-red-200",
};

const wrap: Record<FleetTelemetryLevel, string> = {
  operational: "bg-emerald-100 dark:bg-emerald-950/60",
  stale: "bg-amber-100 dark:bg-amber-950/60",
  offline: "bg-red-100 dark:bg-red-950/60",
};

type Props = {
  healthStatus: string | null | undefined;
  lastHeartbeatAt: string | Date | null | undefined;
  /** When no probe has run yet, show a neutral placeholder. */
  showPending?: boolean;
};

/**
 * High-density mesh probe tri-state: Operational (emerald) / Stale (amber) / Offline (red).
 */
export function MeshTelemetryPill({
  healthStatus,
  lastHeartbeatAt,
  showPending = true,
}: Props) {
  if (!lastHeartbeatAt && !healthStatus) {
    if (!showPending) {
      return null;
    }
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-zinc-300 px-2 py-0.5 font-mono text-[10px] text-zinc-500 dark:border-zinc-600 dark:text-zinc-500">
        Mesh: —
      </span>
    );
  }

  const level = deriveTelemetryDisplay(healthStatus, lastHeartbeatAt);
  return (
    <span
      className={`inline-flex max-w-full shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${wrap[level]}`}
      title="PostgREST mesh probe (2m)"
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot[level]}`}
        aria-hidden
      />
      <span className={`min-w-0 font-medium ${text[level]}`}>
        {fleetTelemetryLabel(level)}
      </span>
    </span>
  );
}

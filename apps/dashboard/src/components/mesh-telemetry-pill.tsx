import type { FluxProjectSummary } from "@flux/core/standalone";
import {
  type FleetTelemetryLevel,
  deriveTelemetryDisplay,
  fleetTelemetryLabel,
} from "@/src/lib/fleet-telemetry-display";

const borderBase = "border";

const wrap: Record<FleetTelemetryLevel, string> = {
  operational: `${borderBase} border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/50`,
  initializing: `${borderBase} border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900`,
  standby: `${borderBase} border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900`,
  offline: `${borderBase} border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/50`,
};

const dot: Record<FleetTelemetryLevel, string> = {
  operational: "bg-emerald-500",
  initializing: "bg-zinc-500",
  standby: "bg-zinc-600",
  offline: "bg-red-500",
};

const text: Record<FleetTelemetryLevel, string> = {
  operational: "text-emerald-800 dark:text-emerald-200",
  initializing: "text-zinc-700 dark:text-zinc-300",
  standby: "text-zinc-700 dark:text-zinc-300",
  offline: "text-red-800 dark:text-red-200",
};

type Props = {
  healthStatus: string | null | undefined;
  lastHeartbeatAt: string | Date | null | undefined;
  createdAt: string;
  /** Docker stack state from the projects list / detail API. */
  stackStatus: FluxProjectSummary["status"];
};

/**
 * Mesh readout: Online / Initializing (pending zinc) / Standby (dim) / Offline (red).
 */
export function MeshTelemetryPill({
  healthStatus,
  lastHeartbeatAt,
  createdAt,
  stackStatus,
}: Props) {
  const level = deriveTelemetryDisplay({
    healthStatus,
    lastHeartbeatAt,
    createdAt,
    stackStatus,
  });

  return (
    <span
      className={`inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${wrap[level]}`}
      title="PostgREST mesh (catalog + Docker; 2m default tick)"
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot[level]}`}
        aria-hidden
      />
      <span className={`min-w-0 font-medium ${text[level]}`}>
        {humanTelemetryLabel(level, fleetTelemetryLabel(level))}
      </span>
    </span>
  );
}

function humanTelemetryLabel(
  level: FleetTelemetryLevel,
  fallback: string,
): string {
  if (level === "initializing") return "Starting";
  if (level === "standby") return "Offline";
  if (level === "offline") return "Error";
  if (level === "operational") return "Online";
  return fallback;
}

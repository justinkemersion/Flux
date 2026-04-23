import type { FluxProjectSummary } from "@flux/core/standalone";
import {
  type FleetTelemetryLevel,
  deriveTelemetryDisplay,
  fleetTelemetryLabel,
} from "@/src/lib/fleet-telemetry-display";

const borderBase = "border border-zinc-800/90";

const wrap: Record<FleetTelemetryLevel, string> = {
  operational: `${borderBase} bg-zinc-950/80`,
  initializing: `${borderBase} bg-zinc-950/80`,
  standby: `${borderBase} bg-zinc-950/60`,
  offline: `${borderBase} bg-zinc-950/80`,
};

const dot: Record<FleetTelemetryLevel, string> = {
  operational: "bg-emerald-500",
  initializing: "bg-zinc-500",
  standby: "bg-zinc-600",
  offline: "bg-red-500",
};

const text: Record<FleetTelemetryLevel, string> = {
  operational: "text-emerald-200",
  initializing: "text-zinc-400",
  standby: "text-zinc-500",
  offline: "text-red-200",
};

type Props = {
  healthStatus: string | null | undefined;
  lastHeartbeatAt: string | Date | null | undefined;
  createdAt: string;
  /** Docker stack state from the projects list / detail API. */
  stackStatus: FluxProjectSummary["status"];
};

/**
 * Mesh readout: Operational / Initializing (pending zinc) / Standby (dim) / Offline (red).
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
      className={`inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-sm px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${wrap[level]}`}
      title="PostgREST mesh (catalog + Docker; 2m default tick)"
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

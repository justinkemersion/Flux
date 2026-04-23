import type { FleetReliability } from "@/src/lib/fleet-monitor";

type Props = {
  reliability: FleetReliability;
};

/**
 * V1.0 production strip: 24h mesh probe success rate (industrial, Geist Mono).
 */
export function ReliabilityBadge({ reliability }: Props) {
  const { percent, successCount, totalCount, windowHours } = reliability;
  const pctText =
    percent == null
      ? "N/A"
      : percent >= 99.95
        ? `${percent.toFixed(0)}%`
        : `${percent.toFixed(1)}%`;

  return (
    <aside
      className="w-full border border-zinc-800 bg-zinc-950 px-3 py-2.5 sm:max-w-[16.5rem] sm:shrink-0"
      aria-label={`${String(windowHours)} hour mesh reliability`}
    >
      <p className="font-mono text-[9px] font-medium uppercase leading-tight tracking-[0.16em] text-zinc-500">
        V1.0_STABLE · {String(windowHours)}H reliability
      </p>
      <p className="mt-1.5 font-mono text-xl font-semibold leading-none tabular-nums tracking-tight text-zinc-100">
        {pctText}
      </p>
      <p className="mt-1.5 font-mono text-[9px] leading-relaxed text-zinc-500">
        <span className="text-zinc-400">{String(successCount)}</span>
        <span className="text-zinc-600"> / </span>
        <span className="text-zinc-400">{String(totalCount)}</span>
        <span className="text-zinc-600"> probes · mesh</span>
      </p>
    </aside>
  );
}

import { getShowcaseStats, type ShowcaseStatus } from "../data/showcase-apps";

const ORDER: ShowcaseStatus[] = ["Active", "Demo Ready", "Alpha", "Concept"];

const labelByStatus: Record<ShowcaseStatus, string> = {
  Active: "Active",
  "Demo Ready": "Demo ready",
  Alpha: "Alpha",
  Concept: "Concept",
};

const colorByStatus: Record<ShowcaseStatus, string> = {
  Active: "text-emerald-400/80",
  "Demo Ready": "text-teal-400/80",
  Alpha: "text-amber-400/80",
  Concept: "text-zinc-500",
};

export function ShowcaseStats() {
  const { byStatus } = getShowcaseStats();
  const entries = ORDER.filter((s) => byStatus[s]);

  return (
    <dl
      className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2"
      aria-label="App counts by status"
    >
      {entries.map((status, i) => (
        <div key={status} className="flex items-center gap-2">
          {i > 0 && <span className="text-zinc-700" aria-hidden="true">·</span>}
          <dt className="sr-only">{labelByStatus[status]}</dt>
          <dd className="flex items-baseline gap-1.5">
            <span className={`text-base font-medium tabular-nums ${colorByStatus[status]}`}>
              {byStatus[status]}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-600">
              {labelByStatus[status]}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

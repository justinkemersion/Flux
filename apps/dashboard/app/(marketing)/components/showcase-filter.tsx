"use client";

import { useState } from "react";
import type { ShowcaseApp, ShowcaseStatus } from "../data/showcase-apps";
import { focusSecondary, stackChipClass, statusPillClass } from "./landing-ui";
import { ShowcaseAppCard } from "./showcase-app-card";

type FilterValue = ShowcaseStatus | "All";

const FILTERS: FilterValue[] = ["All", "Active", "Demo Ready", "Alpha", "Concept"];

function FilterButton({
  value,
  active,
  onClick,
}: {
  value: FilterValue;
  active: boolean;
  onClick: () => void;
}) {
  const base = `inline-flex min-h-[36px] items-center rounded-md border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${focusSecondary}`;
  const activeClass = "border-zinc-600 bg-zinc-800 text-zinc-200";
  const idleClass = "border-zinc-800 bg-transparent text-zinc-500 hover:border-zinc-700 hover:text-zinc-300";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${base} ${active ? activeClass : idleClass}`}
    >
      {value}
    </button>
  );
}

export function ShowcaseFilterGrid({ apps }: { apps: ShowcaseApp[] }) {
  const [filter, setFilter] = useState<FilterValue>("All");

  const visible =
    filter === "All" ? apps : apps.filter((a) => a.status === filter);

  const hasFilter = apps.some(
    (a) => FILTERS.slice(1).includes(a.status as FilterValue),
  );

  if (!hasFilter) {
    return (
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
        {apps.map((app) => (
          <li key={app.id}>
            <ShowcaseAppCard app={app} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div>
      <div
        role="group"
        aria-label="Filter apps by status"
        className="mb-5 flex flex-wrap gap-2"
      >
        {FILTERS.filter((f) => f === "All" || apps.some((a) => a.status === f)).map((f) => (
          <FilterButton
            key={f}
            value={f}
            active={filter === f}
            onClick={() => setFilter(f)}
          />
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-zinc-600">No apps match this filter.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
          {visible.map((app) => (
            <li key={app.id}>
              <ShowcaseAppCard app={app} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import {
  PORTFOLIO_SECTION_LABELS,
  PORTFOLIO_SECTION_ORDER,
  type PortfolioLifecycleSection,
  groupProjectsForPortfolio,
} from "@flux/core/project-portfolio";
import type { ProjectRow } from "@/src/components/projects/project-types";
import { ProjectSummaryCard } from "@/src/components/projects/project-summary-card";

type Props = {
  projects: ProjectRow[];
  onOpenDetail: (slug: string) => void;
  onRepaired: (slug: string) => void;
  onPowerChanged: () => void;
};

export function ProjectPortfolioSections({
  projects,
  onOpenDetail,
  onRepaired,
  onPowerChanged,
}: Props) {
  const grouped = groupProjectsForPortfolio(projects);
  const staggerById = new Map<string, number>();
  let nextStagger = 0;
  for (const section of PORTFOLIO_SECTION_ORDER) {
    for (const row of grouped[section]) {
      staggerById.set(row.id, nextStagger);
      nextStagger += 1;
    }
  }

  return (
    <div className="space-y-10">
      {PORTFOLIO_SECTION_ORDER.map((section: PortfolioLifecycleSection) => {
        const rows = grouped[section];
        if (rows.length === 0) return null;

        return (
          <section key={section} aria-labelledby={`portfolio-${section}`}>
            <div className="mb-4 border-b border-zinc-800/80 pb-2">
              <h2
                id={`portfolio-${section}`}
                className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500"
              >
                {PORTFOLIO_SECTION_LABELS[section]}
              </h2>
            </div>
            <ul
              className="grid list-none grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5"
              aria-label={`${PORTFOLIO_SECTION_LABELS[section]} projects`}
            >
              {rows.map((p) => (
                  <li key={p.id}>
                    <ProjectSummaryCard
                      project={p}
                      staggerIndex={staggerById.get(p.id) ?? 0}
                      onOpenDetail={() => onOpenDetail(p.slug)}
                      onRepaired={() => onRepaired(p.slug)}
                      onPowerChanged={onPowerChanged}
                    />
                  </li>
                ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

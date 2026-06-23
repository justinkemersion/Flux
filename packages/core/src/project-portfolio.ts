/**
 * Portfolio dashboard helpers — lifecycle grouping and human activity labels.
 */

import type { ProjectLifecycleState } from "./project-lifecycle-state.ts";
import { normalizeProjectLifecycleState } from "./project-lifecycle-state.ts";

export type PortfolioLifecycleSection = "active" | "dormant" | "archived";

export const PORTFOLIO_SECTION_ORDER: PortfolioLifecycleSection[] = [
  "active",
  "dormant",
  "archived",
];

export const PORTFOLIO_SECTION_LABELS: Record<PortfolioLifecycleSection, string> =
  {
    active: "Active",
    dormant: "Dormant",
    archived: "Archived",
  };

export type PortfolioProjectLike = {
  lifecycleState?: ProjectLifecycleState | string | null;
};

export function portfolioSectionForProject(
  project: PortfolioProjectLike,
): PortfolioLifecycleSection {
  return normalizeProjectLifecycleState(project.lifecycleState);
}

export function groupProjectsForPortfolio<T extends PortfolioProjectLike>(
  projects: readonly T[],
): Record<PortfolioLifecycleSection, T[]> {
  const out: Record<PortfolioLifecycleSection, T[]> = {
    active: [],
    dormant: [],
    archived: [],
  };
  for (const project of projects) {
    out[portfolioSectionForProject(project)].push(project);
  }
  return out;
}

/** Relative last-activity line for fleet cards (UTC calendar day buckets). */
export function formatPortfolioLastActivity(
  iso: string | null | undefined,
  now = new Date(),
): string | null {
  if (!iso?.trim()) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const startOfDay = (x: Date): number =>
    Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const diffDays = Math.round(
    (startOfDay(now) - startOfDay(d)) / (24 * 60 * 60 * 1000),
  );

  if (diffDays === 0) return "Active today";
  if (diffDays === 1) return "Active yesterday";
  if (diffDays < 7) return `Last active ${String(diffDays)} days ago`;
  if (diffDays < 30) {
    const weeks = Math.max(1, Math.round(diffDays / 7));
    return weeks === 1 ? "Last active 1 week ago" : `Last active ${String(weeks)} weeks ago`;
  }
  const months = Math.max(1, Math.round(diffDays / 30));
  return months === 1 ? "Last active 1 month ago" : `Last active ${String(months)} months ago`;
}

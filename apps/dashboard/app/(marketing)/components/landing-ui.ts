import type { ShowcaseStatus } from "../data/showcase-apps";

export const focusPrimary =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

export const focusSecondary =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

export const primaryCtaClass = `inline-flex min-h-[44px] items-center justify-center rounded-md bg-white px-6 py-3 text-base font-medium text-zinc-950 transition-colors hover:bg-zinc-100 ${focusPrimary}`;

export const secondaryCtaClass = `inline-flex min-h-[44px] items-center justify-center rounded-md border border-zinc-600/70 bg-zinc-950/30 px-5 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:border-zinc-500 hover:bg-zinc-900/40 hover:text-zinc-200 ${focusSecondary}`;

export const sectionLabelClass =
  "font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500";

export const sectionTitleClass =
  "mt-3 text-2xl font-medium tracking-tight text-white sm:text-3xl";

export const cardClass =
  "flex h-full flex-col rounded-md border border-zinc-800 bg-zinc-950/80 p-5 transition-colors duration-200 hover:border-zinc-700 hover:bg-zinc-900/30 md:p-6";

const pillBase =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em]";

const pillByStatus: Record<ShowcaseStatus, string> = {
  Active: "border-emerald-800/60 text-emerald-400/90",
  "Demo Ready": "border-teal-800/60 text-teal-400/90",
  Alpha: "border-amber-800/60 text-amber-400/90",
  Concept: "border-zinc-700/70 text-zinc-500",
};

export function statusPillClass(status: ShowcaseStatus): string {
  return `${pillBase} ${pillByStatus[status]}`;
}

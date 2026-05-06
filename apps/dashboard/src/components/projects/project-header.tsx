"use client";

import type { ReactNode } from "react";

type ProjectHeaderProps = {
  title: string;
  subtitle: string;
  /** Stack + mesh status controls (e.g. badges). */
  statusRow: ReactNode;
  /** Primary actions (e.g. Open Console, Settings). */
  primaryActions: ReactNode;
  /** Power, repair, delete, and other secondary controls. */
  secondaryActions?: ReactNode;
  /**
   * `inset` — inside padded project card (bleeds to card edges).
   * `flush` — full-width page shell (no negative margins).
   */
  variant?: "inset" | "flush";
};

/**
 * Top-of-card identity: name, subtitle, status, and action clusters.
 */
export function ProjectHeader({
  title,
  subtitle,
  statusRow,
  primaryActions,
  secondaryActions,
  variant = "inset",
}: ProjectHeaderProps) {
  const shellCls =
    variant === "inset"
      ? "-mx-6 -mt-6 mb-5 border-b border-zinc-200/80 bg-zinc-50/70 px-6 pt-6 pb-5 dark:border-zinc-800/80 dark:bg-zinc-900/30"
      : "mb-7 rounded-md border border-zinc-200/80 bg-zinc-50/70 px-5 py-4 dark:border-zinc-800/80 dark:bg-zinc-900/30";

  return (
    <header className={shellCls} aria-label="Project">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-2.5">
          <div>
            <h2 className="truncate font-serif text-2xl font-medium tracking-tight text-zinc-900 dark:text-zinc-50">
              {title}
            </h2>
            <p className="mt-1 truncate text-sm text-zinc-500 dark:text-zinc-400">
              {subtitle}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">{statusRow}</div>
        </div>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <div className="flex flex-wrap items-center gap-2">{primaryActions}</div>
          {secondaryActions ? (
            <div className="flex flex-wrap items-center gap-2">{secondaryActions}</div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

"use client";

import { Loader2 } from "lucide-react";

/** Stack power state plus optimistic UI while start/stop is in flight. */
export type DisplayStatus =
  | "running"
  | "stopped"
  | "partial"
  | "missing"
  | "corrupted"
  | "transitioning";

export function StatusBadge({ status }: { status: DisplayStatus }) {
  const base =
    "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium";
  switch (status) {
    case "running":
      return (
        <span
          className={`${base} bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200`}
        >
          <span
            className="h-1.5 w-1.5 rounded-full bg-emerald-500"
            aria-hidden
          />
          Online
        </span>
      );
    case "stopped":
      return (
        <span
          className={`${base} bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100`}
        >
          <span
            className="h-1.5 w-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500"
            aria-hidden
          />
          Offline
        </span>
      );
    case "transitioning":
      return (
        <span
          className={`${base} bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200`}
        >
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          Transitioning
        </span>
      );
    case "missing":
      return (
        <span
          className={`${base} bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200`}
        >
          <span
            className="h-1.5 w-1.5 rounded-full bg-red-500"
            aria-hidden
          />
          Missing
        </span>
      );
    case "corrupted":
      return (
        <span
          className={`${base} bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200`}
        >
          <span
            className="h-1.5 w-1.5 rounded-full bg-orange-500"
            aria-hidden
          />
          Drift
        </span>
      );
    case "partial":
      return (
        <span
          className={`${base} bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-orange-500" aria-hidden />
          Partial
        </span>
      );
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

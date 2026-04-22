"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";

function formatUtc(d: Date): string {
  const p = (n: number) => n.toString().padStart(2, "0");
  const y = d.getUTCFullYear();
  const mo = p(d.getUTCMonth() + 1);
  const day = p(d.getUTCDate());
  const h = p(d.getUTCHours());
  const m = p(d.getUTCMinutes());
  const s = p(d.getUTCSeconds());
  return `${y}-${mo}-${day} ${h}:${m}:${s} UTC`;
}

const focus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

type Props = {
  userSegment: string;
  fleetLine: string;
  fleetDegraded: boolean;
  onNewProject: () => void;
};

export function ProjectsFleetBar({
  userSegment,
  fleetLine,
  fleetDegraded,
  onNewProject,
}: Props) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-3 px-4 py-3 sm:grid-cols-[1fr_auto_1fr] sm:gap-4 sm:px-8 lg:px-10">
        <nav
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500"
          aria-label="Breadcrumb"
        >
          <Link
            href="/"
            className={`shrink-0 text-zinc-400 transition-colors hover:text-zinc-200 ${focus}`}
          >
            FLUX
          </Link>
          <span className="text-zinc-700" aria-hidden>
            /
          </span>
          <span
            className="min-w-0 truncate text-zinc-500"
            title={userSegment}
          >
            USER_{userSegment}
          </span>
          <span className="text-zinc-700" aria-hidden>
            /
          </span>
          <span className="shrink-0 text-zinc-400">PROJECTS</span>
        </nav>

        <div className="flex justify-center">
          <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
            {fleetDegraded ? (
              <span
                className="h-2 w-2 shrink-0 rounded-full bg-amber-500/90"
                aria-hidden
              />
            ) : (
              <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/35" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
            )}
            <span className="whitespace-nowrap">
              [&nbsp;{fleetLine}&nbsp;]
            </span>
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 sm:justify-self-end">
          <time
            className="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500 tabular-nums"
            dateTime={now.toISOString()}
            suppressHydrationWarning
          >
            {formatUtc(now)}
          </time>
          <button
            type="button"
            onClick={() => {
              void signOut({ callbackUrl: "/projects" });
            }}
            className={`rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500 transition-colors hover:text-zinc-300 ${focus}`}
          >
            Sign out
          </button>
          <button
            type="button"
            onClick={onNewProject}
            className={`rounded-md border border-zinc-700 bg-transparent px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-900/80 ${focus}`}
          >
            +_NEW_PROJECT
          </button>
        </div>
      </div>
    </header>
  );
}

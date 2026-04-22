import type { Metadata } from "next";
import Link from "next/link";
import { CodexQueryPanel } from "@/src/components/codex-query-panel";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Codex — Flux",
  description: "AI documentation for Flux core rules and CLI reference.",
};

export default function DocsPage() {
  return (
    <main className="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-3xl px-4 py-10 sm:px-8">
      <div className="font-mono text-[13px] leading-relaxed text-zinc-800 dark:text-zinc-300">
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-emerald-600/90 dark:text-emerald-400/90">
              Module
            </p>
            <h1 className="mt-1 text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              CODEX
            </h1>
          </div>
          <div className="flex flex-wrap gap-4 text-[10px] uppercase tracking-[0.16em]">
            <Link
              href="/"
              className="text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              ←_FLUX
            </Link>
            <Link
              href="/api/auth/signin?callbackUrl=%2Fdocs"
              className="text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              FLEET_
            </Link>
          </div>
        </div>

        <div className="rounded-sm border border-zinc-300 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.02)] dark:border-zinc-800 dark:bg-zinc-950/80">
          <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
              aria-hidden
            />
            <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              Terminal_session · public_read
            </span>
          </div>
          <CodexQueryPanel />
        </div>
      </div>
    </main>
  );
}

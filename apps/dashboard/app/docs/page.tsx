import type { Metadata } from "next";
import Link from "next/link";
import { CodexManual } from "@/src/components/docs/codex-manual";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Docs — Flux",
  description: "Install, control plane, CLI reference, and Codex manual. Interactive queries on the home page.",
};

export default function DocsPage() {
  return (
    <main className="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-5xl px-4 py-10 sm:px-8">
      <div className="font-mono text-[13px] leading-relaxed text-zinc-800 dark:text-zinc-300">
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-emerald-600/90 dark:text-emerald-400/90">
              Module
            </p>
            <h1 className="mt-1 text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              DOCS_&_CODEX
            </h1>
          </div>
          <div className="flex flex-wrap gap-4 text-[10px] uppercase tracking-[0.16em]">
            <Link
              href="/"
              className="text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              ←_FLUX
            </Link>
            <a
              href="#install"
              className="text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              #install
            </a>
            <a
              href="#authentication"
              className="text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              #auth
            </a>
            <a
              href="#create"
              className="text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              #create
            </a>
            <a
              href="#accessing-data"
              className="text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              #api
            </a>
            <a
              href="#advanced"
              className="text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              #advanced
            </a>
            <Link
              href="/api/auth/signin?callbackUrl=%2Fdocs"
              className="text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              FLEET_
            </Link>
          </div>
        </div>

        <div className="mb-10">
          <CodexManual />
        </div>

        <p className="mt-8 border border-zinc-200 bg-zinc-50/80 p-4 text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-500">
          Interactive Codex queries live on the{" "}
          <Link
            href="/"
            className="text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400/90"
          >
            home page
          </Link>
          {" "}
          under{" "}
          <span className="font-mono text-zinc-800 dark:text-zinc-300">
            [ AI_CODEX_NAVIGATOR ]
          </span>
          .
        </p>
      </div>
    </main>
  );
}

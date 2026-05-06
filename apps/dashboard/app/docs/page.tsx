import type { Metadata } from "next";
import Link from "next/link";
import { CodexManual } from "@/src/components/docs/codex-manual";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Docs — Flux",
  description:
    "Install the CLI, create your first project, connect your app, and understand how Flux works.",
};

export default function DocsPage() {
  return (
    <main className="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-5xl px-4 py-10 sm:px-8">
      <div className="mb-8 border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Documentation
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Everything you need to install, configure, and use Flux.
        </p>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
          <a
            href="#install"
            className="text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-800 hover:underline dark:hover:text-zinc-200"
          >
            Installation
          </a>
          <a
            href="#authentication"
            className="text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-800 hover:underline dark:hover:text-zinc-200"
          >
            Authentication
          </a>
          <a
            href="#create"
            className="text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-800 hover:underline dark:hover:text-zinc-200"
          >
            Create a project
          </a>
          <a
            href="#accessing-data"
            className="text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-800 hover:underline dark:hover:text-zinc-200"
          >
            Accessing data
          </a>
          <a
            href="#execution-modes"
            className="text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-800 hover:underline dark:hover:text-zinc-200"
          >
            Dedicated vs Pooled
          </a>
          <a
            href="#advanced"
            className="text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-800 hover:underline dark:hover:text-zinc-200"
          >
            Reference
          </a>
          <Link
            href="/docs/v2-first-request"
            className="text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-800 hover:underline dark:hover:text-zinc-200"
          >
            Pooled stack guide →
          </Link>
        </div>
      </div>

      <div className="mb-10">
        <CodexManual />
      </div>

      <p className="mt-8 rounded-md border border-zinc-200 bg-zinc-50/80 p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-400">
        Have a question?{" "}
        <Link
          href="/"
          className="text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
        >
          Try the interactive assistant on the home page.
        </Link>
      </p>
    </main>
  );
}

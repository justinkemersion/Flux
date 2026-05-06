import type { Metadata } from "next";
import Link from "next/link";
import { CodexManual } from "@/src/components/docs/codex-manual";
import {
  docsFocus,
  docsMuted,
  docsPageSubtitle,
  docsPageTitle,
  docsProseLink,
  docsTocLink,
} from "@/src/components/docs/docs-styles";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Docs — Flux",
  description:
    "Install the CLI, create your first project, connect your app, and understand how Flux works.",
};

export default function DocsPage() {
  return (
    <main className="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-5xl px-4 py-10 sm:px-8">
      <header className="border-b border-zinc-200 pb-8 dark:border-zinc-800">
        <h1 className={docsPageTitle}>Documentation</h1>
        <p className={docsPageSubtitle}>
          Everything you need to install, configure, and use Flux.
        </p>
        <nav className="mt-5 flex flex-wrap gap-x-5 gap-y-2" aria-label="On this page">
          <a href="#install" className={`${docsTocLink} ${docsFocus} rounded-sm`}>
            Installation
          </a>
          <a href="#authentication" className={`${docsTocLink} ${docsFocus} rounded-sm`}>
            Authentication
          </a>
          <a href="#create" className={`${docsTocLink} ${docsFocus} rounded-sm`}>
            Create a project
          </a>
          <a href="#accessing-data" className={`${docsTocLink} ${docsFocus} rounded-sm`}>
            Accessing data
          </a>
          <a href="#execution-modes" className={`${docsTocLink} ${docsFocus} rounded-sm`}>
            Dedicated vs Pooled
          </a>
          <a href="#advanced" className={`${docsTocLink} ${docsFocus} rounded-sm`}>
            Reference
          </a>
          <Link href="/docs/v2-first-request" className={`${docsTocLink} ${docsFocus} rounded-sm`}>
            Pooled stack guide →
          </Link>
        </nav>
      </header>

      <div className="mt-12">
        <CodexManual />
      </div>

      <aside
        className={`mt-14 rounded-lg border border-zinc-200 bg-zinc-50/90 p-5 ${docsMuted} dark:border-zinc-800 dark:bg-zinc-950/40`}
      >
        Have a question?{" "}
        <Link href="/" className={docsProseLink}>
          Try the interactive assistant on the home page.
        </Link>
      </aside>
    </main>
  );
}

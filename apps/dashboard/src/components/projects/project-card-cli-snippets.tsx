"use client";

import { Check, Clipboard } from "lucide-react";
import { useState } from "react";

function CliSnippetRow({ line }: { line: string }) {
  const [copied, setCopied] = useState(false);

  async function copyLine(): Promise<void> {
    try {
      await navigator.clipboard.writeText(line);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard denied */
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
      <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border border-zinc-200 bg-white px-3 py-2.5 font-mono text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
        {line}
      </pre>
      <button
        type="button"
        onClick={() => void copyLine()}
        className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        {copied ? (
          <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
        ) : (
          <Clipboard className="h-4 w-4" aria-hidden />
        )}
        Copy
      </button>
    </div>
  );
}

export function ProjectCardCliSnippetBlock({
  slug,
  hash,
  v1Dedicated,
}: {
  slug: string;
  hash: string;
  v1Dedicated: boolean;
}) {
  const pushLine = `flux push migrations/ --project ${slug} --hash ${hash}`;
  const credLine = `flux project credentials ${slug} --hash ${hash}`;

  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/30">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">CLI</h3>
      <div className="mt-3 flex flex-col gap-3">
        <CliSnippetRow line={pushLine} />
        {v1Dedicated ? (
          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Postgres URI and keys (terminal)
            </p>
            <CliSnippetRow line={credLine} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

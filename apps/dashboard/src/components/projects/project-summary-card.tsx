"use client";

import { Check, Clipboard } from "lucide-react";
import { useState } from "react";
import type { ProjectRow } from "@/src/components/projects/project-card";
import {
  hashSegment,
  projectApiInterface,
} from "@/src/lib/routing-identity";

type ServerStatus = ProjectRow["status"];

function statusLabel(status: ServerStatus): string {
  switch (status) {
    case "running":
      return "Online";
    case "stopped":
      return "Offline";
    case "partial":
      return "Partial";
    case "missing":
      return "Missing";
    case "corrupted":
      return "Drift";
    default: {
      const _e: never = status;
      return _e;
    }
  }
}

function StatusDot({ status }: { status: ServerStatus }) {
  const cls =
    status === "running"
      ? "bg-emerald-500"
      : status === "partial"
        ? "bg-orange-500"
        : status === "stopped"
          ? "bg-zinc-400 dark:bg-zinc-500"
          : "bg-red-500";
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${cls}`}
      aria-hidden
    />
  );
}

type Props = {
  project: ProjectRow;
  onOpenDetail: () => void;
};

export function ProjectSummaryCard({ project: p, onOpenDetail }: Props) {
  const [copied, setCopied] = useState(false);

  const hash = hashSegment(`${p.slug}:${p.id}`);
  const specHost = projectApiInterface(p.slug, hash);
  const apiText = (p.apiUrl?.trim() || specHost).trim();
  const apiHref = /^https?:\/\//i.test(apiText)
    ? apiText
    : `https://${apiText}`;

  async function copyApiUrl(): Promise<void> {
    try {
      await navigator.clipboard.writeText(apiText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* denied */
    }
  }

  return (
    <article
      className="flex flex-col rounded-md border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
      aria-label={`Project ${p.name}`}
    >
      <div className="min-w-0">
        <button
          type="button"
          onClick={onOpenDetail}
          className="w-full text-left text-xl font-semibold leading-snug text-zinc-900 transition-colors hover:text-zinc-700 dark:text-zinc-50 dark:hover:text-zinc-200"
        >
          {p.name}
        </button>
      </div>

      <div className="mt-4 flex min-w-0 items-stretch gap-2">
        <a
          href={apiHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 flex-1 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2.5 font-mono text-xs leading-snug text-zinc-800 transition-colors hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
          title={apiText}
        >
          <span className="truncate">{apiText}</span>
        </a>
        <button
          type="button"
          onClick={() => void copyApiUrl()}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600 shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label="Copy API URL"
        >
          {copied ? (
            <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
          ) : (
            <Clipboard className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800/80">
        <span className="inline-flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <StatusDot status={p.status} />
          {statusLabel(p.status)}
        </span>
        <span className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-500">
          #{hash}
        </span>
      </div>
    </article>
  );
}

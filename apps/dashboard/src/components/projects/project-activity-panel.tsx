"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DocsMarkdown } from "@/src/components/docs/docs-markdown";

type ActivityEvent = {
  id: string;
  kind: string;
  summary: string;
  createdAt: string;
};

type Props = {
  slug: string;
  hash: string;
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dayBucket(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  const now = new Date();
  const start = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / (24 * 60 * 60 * 1000));
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function ProjectActivityPanel({ slug, hash }: Props) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/timeline?hash=${encodeURIComponent(hash)}&limit=30`,
      );
      const body = (await res.json()) as {
        events?: ActivityEvent[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `Request failed (${String(res.status)})`);
      }
      setEvents(Array.isArray(body.events) ? body.events : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load activity.");
    } finally {
      setLoading(false);
    }
  }, [hash, slug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSummarize(): Promise<void> {
    setSummarizing(true);
    setSummaryError(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/ai/summary?hash=${encodeURIComponent(hash)}&kind=activity`,
        { method: "POST" },
      );
      const body = (await res.json()) as {
        summary?: { markdown?: string };
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `Summary failed (${String(res.status)})`);
      }
      setSummary(body.summary?.markdown?.trim() ?? null);
    } catch (err: unknown) {
      setSummaryError(
        err instanceof Error ? err.message : "Failed to summarize activity.",
      );
    } finally {
      setSummarizing(false);
    }
  }

  let lastDay = "";
  const rows: ReactNode[] = [];
  for (const event of events) {
    const day = dayBucket(event.createdAt);
    if (day !== lastDay) {
      rows.push(
        <p
          key={`day-${day}-${event.id}`}
          className="pt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-500"
        >
          {day}
        </p>,
      );
      lastDay = day;
    }
    rows.push(
      <li key={event.id} className="py-1.5">
        <p className="text-sm text-zinc-900 dark:text-zinc-100">{event.summary}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          {formatWhen(event.createdAt)}
        </p>
      </li>,
    );
  }

  return (
    <section
      className="rounded-md border border-zinc-200/70 bg-white/60 p-4 dark:border-zinc-800/60 dark:bg-zinc-950/30"
      aria-label="Project activity timeline"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Activity
          </h4>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">
            Recent lifecycle events. Run{" "}
            <code className="font-mono">flux project summarize --hash {hash}</code>{" "}
            for an AI summary.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void onSummarize()}
            disabled={summarizing || loading}
            className="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {summarizing ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-3 w-3" aria-hidden />
            )}
            Summarize
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Refresh
          </button>
        </div>
      </div>

      {summary ? (
        <div className="mt-4 rounded-md border border-zinc-200/80 bg-white/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            AI summary
          </p>
          <DocsMarkdown markdown={summary} />
        </div>
      ) : null}
      {summaryError ? (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{summaryError}</p>
      ) : null}

      {loading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading activity…
        </p>
      ) : error ? (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : events.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-500">
          No activity recorded yet.
        </p>
      ) : (
        <ul className="mt-3 list-none space-y-0">{rows}</ul>
      )}
    </section>
  );
}

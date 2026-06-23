"use client";

import { buildFluxMdGenerationPrompt, FLUX_MD_FILENAME } from "@flux/core/flux-md";
import { Check, Copy, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DocsMarkdown } from "@/src/components/docs/docs-markdown";

type FluxMdPayload = {
  slug: string;
  hash: string;
  name: string;
  content: string | null;
  syncedAt: string | null;
};

type Props = {
  slug: string;
  hash: string;
};

export function ProjectFluxMdPanel({ slug, hash }: Props) {
  const [data, setData] = useState<FluxMdPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generationPrompt = useMemo(() => {
    if (!data) return "";
    return buildFluxMdGenerationPrompt({
      name: data.name,
      slug: data.slug,
      hash: data.hash,
    });
  }, [data]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/flux-md?hash=${encodeURIComponent(hash)}`,
      );
      const body = (await res.json()) as {
        fluxMd?: FluxMdPayload;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `Request failed (${String(res.status)})`);
      }
      setData(body.fluxMd ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load project brief.");
    } finally {
      setLoading(false);
    }
  }, [hash, slug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onCopyPrompt(): Promise<void> {
    if (!generationPrompt) return;
    try {
      await navigator.clipboard.writeText(generationPrompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard denied */
    }
  }

  const hasContent = Boolean(data?.content?.trim());

  return (
    <section
      className="rounded-md border border-zinc-200/70 bg-white/60 p-4 dark:border-zinc-800/60 dark:bg-zinc-950/30"
      aria-label="FLUX.md project brief"
    >
      <div>
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Project brief ({FLUX_MD_FILENAME})
        </h4>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">
          Repo-level context for future-you — not a README. Sync from your app repo
          with{" "}
          <code className="font-mono">flux project brief push --hash {hash}</code>
        </p>
      </div>

      {loading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading…
        </p>
      ) : error ? (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : hasContent ? (
        <div className="mt-4">
          {data?.syncedAt ? (
            <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-500">
              Last synced {new Date(data.syncedAt).toLocaleString()}
            </p>
          ) : null}
          <div className="max-h-[28rem] overflow-y-auto rounded-md border border-zinc-200/80 bg-white/80 p-4 dark:border-zinc-800 dark:bg-zinc-950/50">
            <DocsMarkdown markdown={data!.content!.trim()} />
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3 rounded-md border border-dashed border-zinc-300/80 bg-zinc-50/50 p-4 dark:border-zinc-700 dark:bg-zinc-950/20">
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            No {FLUX_MD_FILENAME} synced yet
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            This project can still run normally. A Flux project brief helps
            future-you understand the app, schema, and operating assumptions.
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            Add {FLUX_MD_FILENAME} at your repo root (next to{" "}
            <code className="font-mono">flux.json</code>), generate a first draft
            with your coding tool, then push it to the dashboard.
          </p>
          <button
            type="button"
            onClick={() => void onCopyPrompt()}
            disabled={!generationPrompt}
            className="inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-600" aria-hidden />
            ) : (
              <Copy className="h-4 w-4" aria-hidden />
            )}
            {copied ? "Copied" : "Copy generation prompt"}
          </button>
        </div>
      )}
    </section>
  );
}

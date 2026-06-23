"use client";

import {
  buildFluxMdGenerationPrompt,
  FLUX_MD_FILENAME,
  FLUX_MD_SOURCE_OF_TRUTH_NOTE,
  fluxMdEditWorkflowSteps,
  fluxMdPushCommandExplainer,
} from "@flux/core/flux-md";
import { Check, Copy, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DocsMarkdown } from "@/src/components/docs/docs-markdown";
import { CliSnippetRow } from "@/src/components/projects/project-card-cli-snippets";

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

function BriefHelpBox({
  hash,
  variant,
}: {
  hash: string;
  variant: "empty" | "has-content";
}) {
  const pushLine = `flux project brief push --hash ${hash}`;

  if (variant === "empty") {
    return (
      <div className="mt-4 space-y-3 rounded-md border border-zinc-200/80 bg-zinc-50/60 p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-300">
        <p className="font-medium text-zinc-900 dark:text-zinc-100">
          What is this?
        </p>
        <p>{FLUX_MD_SOURCE_OF_TRUTH_NOTE}</p>
        <p>
          You can generate a first draft here or in the CLI, then keep the real
          file in your repo as <code className="font-mono">FLUX.md</code>.
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          {fluxMdPushCommandExplainer(hash)}
        </p>
      </div>
    );
  }

  const steps = fluxMdEditWorkflowSteps(hash);

  return (
    <div className="mt-4 space-y-3 rounded-md border border-amber-200/80 bg-amber-50/40 p-4 text-sm text-zinc-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-zinc-300">
      <p className="font-medium text-zinc-900 dark:text-zinc-100">
        Read-only preview — how to edit
      </p>
      <p>{FLUX_MD_SOURCE_OF_TRUTH_NOTE}</p>
      <p>
        This page does not edit the brief directly. To change what you see,
        update <code className="font-mono">FLUX.md</code> in your app repo, then
        refresh the dashboard copy:
      </p>
      <ol className="list-decimal space-y-1.5 pl-5">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div className="space-y-1.5 pt-1">
        <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Refresh dashboard from repo
        </p>
        <CliSnippetRow line={pushLine} />
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          {fluxMdPushCommandExplainer(hash)}
        </p>
      </div>
    </div>
  );
}

export function ProjectFluxMdPanel({ slug, hash }: Props) {
  const [data, setData] = useState<FluxMdPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedBrief, setCopiedBrief] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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
      setCopiedPrompt(true);
      window.setTimeout(() => setCopiedPrompt(false), 2000);
    } catch {
      /* clipboard denied */
    }
  }

  async function onCopyBrief(): Promise<void> {
    const text = data?.content?.trim() || draft;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedBrief(true);
      window.setTimeout(() => setCopiedBrief(false), 2000);
    } catch {
      /* clipboard denied */
    }
  }

  async function onGenerateDraft(): Promise<void> {
    setGenerating(true);
    setAiError(null);
    setSaved(false);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/ai/summary?hash=${encodeURIComponent(hash)}&kind=brief`,
        { method: "POST" },
      );
      const body = (await res.json()) as {
        summary?: { markdown?: string };
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `Generation failed (${String(res.status)})`);
      }
      const markdown = body.summary?.markdown?.trim();
      if (!markdown) throw new Error("Empty draft returned.");
      setDraft(markdown);
    } catch (err: unknown) {
      setAiError(err instanceof Error ? err.message : "Failed to generate draft.");
    } finally {
      setGenerating(false);
    }
  }

  async function onSaveDraft(): Promise<void> {
    const content = draft?.trim();
    if (!content) return;
    setSaving(true);
    setAiError(null);
    setSaved(false);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/flux-md?hash=${encodeURIComponent(hash)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
      );
      const body = (await res.json()) as { fluxMd?: FluxMdPayload; error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? `Save failed (${String(res.status)})`);
      }
      setData(body.fluxMd ?? null);
      setDraft(null);
      setSaved(true);
    } catch (err: unknown) {
      setAiError(err instanceof Error ? err.message : "Failed to save draft.");
    } finally {
      setSaving(false);
    }
  }

  const displayContent = data?.content?.trim() ?? null;
  const hasContent = Boolean(displayContent);

  return (
    <section
      className="rounded-md border border-zinc-200/70 bg-white/60 p-4 dark:border-zinc-800/60 dark:bg-zinc-950/30"
      aria-label="FLUX.md project brief"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Project brief
          </h4>
          <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
            A five-minute reorientation doc for future-you — not a README.
            Optional; your project runs fine without it.
          </p>
        </div>
        {!loading ? (
          <div className="flex flex-wrap gap-2">
            {hasContent ? (
              <button
                type="button"
                onClick={() => void onCopyBrief()}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                {copiedBrief ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                )}
                {copiedBrief ? "Copied" : "Copy brief"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void onGenerateDraft()}
              disabled={generating || saving}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
              )}
              {generating ? "Generating…" : hasContent ? "Regenerate" : "Generate draft"}
            </button>
          </div>
        ) : null}
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
              Dashboard copy last updated{" "}
              {new Date(data.syncedAt).toLocaleString()}
              {" · "}
              repo file may differ until you push again
            </p>
          ) : null}
          <div className="max-h-[28rem] overflow-y-auto rounded-md border border-zinc-200/80 bg-white/80 p-4 dark:border-zinc-800 dark:bg-zinc-950/50">
            <DocsMarkdown markdown={displayContent!} />
          </div>
          <BriefHelpBox hash={hash} variant="has-content" />
        </div>
      ) : (
        <>
          <div className="mt-4 space-y-3 rounded-md border border-dashed border-zinc-300/80 bg-zinc-50/50 p-4 dark:border-zinc-700 dark:bg-zinc-950/20">
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              No brief on the dashboard yet
            </p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Generate a draft, paste a prompt into Cursor, or push an existing{" "}
              <code className="font-mono">{FLUX_MD_FILENAME}</code> from your repo.
            </p>
            <button
              type="button"
              onClick={() => void onCopyPrompt()}
              disabled={!generationPrompt}
              className="inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              {copiedPrompt ? (
                <Check className="h-4 w-4 text-emerald-600" aria-hidden />
              ) : (
                <Copy className="h-4 w-4" aria-hidden />
              )}
              {copiedPrompt ? "Copied" : "Copy generation prompt"}
            </button>
          </div>
          <BriefHelpBox hash={hash} variant="empty" />
        </>
      )}

      {aiError ? (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{aiError}</p>
      ) : null}
      {saved ? (
        <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">
          Saved to dashboard. To keep it in git, copy into{" "}
          <code className="font-mono">{FLUX_MD_FILENAME}</code> in your repo.
        </p>
      ) : null}

      {draft ? (
        <div className="mt-4 space-y-3 rounded-md border border-zinc-200/80 bg-zinc-50/80 p-4 dark:border-zinc-700 dark:bg-zinc-950/40">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            AI draft — review before saving
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Saving here updates the dashboard copy only. For version control,
            also save as <code className="font-mono">{FLUX_MD_FILENAME}</code> in
            your app repo.
          </p>
          <div className="max-h-64 overflow-y-auto rounded-md border border-zinc-200/80 bg-white/80 p-3 dark:border-zinc-800 dark:bg-zinc-950/50">
            <DocsMarkdown markdown={draft} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void onSaveDraft()}
              disabled={saving}
              className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {saving ? "Saving…" : "Save to dashboard"}
            </button>
            <button
              type="button"
              onClick={() => void onCopyBrief()}
              disabled={saving}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300"
            >
              Copy draft
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              disabled={saving}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const DESCRIPTION_MAX = 280;
const BRIEF_MAX = 8000;

type Metadata = {
  slug: string;
  hash: string;
  name: string;
  description: string | null;
  brief: string | null;
};

type Props = {
  slug: string;
  hash: string;
};

export function ProjectMetadataPanel({ slug, hash }: Props) {
  const [meta, setMeta] = useState<Metadata | null>(null);
  const [description, setDescription] = useState("");
  const [brief, setBrief] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/metadata?hash=${encodeURIComponent(hash)}`,
      );
      const body = (await res.json()) as {
        metadata?: Metadata;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `Request failed (${String(res.status)})`);
      }
      const m = body.metadata ?? null;
      setMeta(m);
      setDescription(m?.description ?? "");
      setBrief(m?.brief ?? "");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load metadata.");
    } finally {
      setLoading(false);
    }
  }, [hash, slug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSave(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/metadata?hash=${encodeURIComponent(hash)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: description.trim() || null,
            brief: brief.trim() || null,
          }),
        },
      );
      const body = (await res.json()) as {
        metadata?: Metadata;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `Save failed (${String(res.status)})`);
      }
      const m = body.metadata ?? null;
      setMeta(m);
      setDescription(m?.description ?? "");
      setBrief(m?.brief ?? "");
      setSaved(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save metadata.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="rounded-md border border-zinc-200/70 bg-white/60 p-4 dark:border-zinc-800/60 dark:bg-zinc-950/30"
      aria-label="Project metadata"
    >
      <div>
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          About this project
        </h4>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">
          Short description for your portfolio and future-you. Repo{" "}
          <code className="font-mono">FLUX.md</code> sync comes in a later phase.
          CLI:{" "}
          <code className="font-mono">flux project metadata --hash {hash}</code>
        </p>
      </div>

      {loading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading…
        </p>
      ) : (
        <form onSubmit={(e) => void onSave(e)} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor={`project-description-${hash}`}
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Description
            </label>
            <input
              id={`project-description-${hash}`}
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={DESCRIPTION_MAX}
              placeholder="e.g. Photography publishing platform"
              disabled={saving}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950"
            />
            <p className="mt-1 text-xs text-zinc-500">
              {description.length}/{DESCRIPTION_MAX}
            </p>
          </div>
          <div>
            <label
              htmlFor={`project-brief-${hash}`}
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Operator brief
            </label>
            <textarea
              id={`project-brief-${hash}`}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              maxLength={BRIEF_MAX}
              rows={5}
              placeholder="What future-you should know in five minutes…"
              disabled={saving}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950"
            />
            <p className="mt-1 text-xs text-zinc-500">
              {brief.length}/{BRIEF_MAX}
            </p>
          </div>

          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : null}
          {saved ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">Saved.</p>
          ) : null}

          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {saving ? "Saving…" : "Save metadata"}
          </button>
        </form>
      )}

      {meta?.description && !loading ? (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-500">
          Fleet cards will show the description when set.
        </p>
      ) : null}
    </section>
  );
}

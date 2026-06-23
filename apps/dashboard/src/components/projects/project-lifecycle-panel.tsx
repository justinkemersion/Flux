"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  lifecycleStateLabel,
  type ProjectLifecycleAction,
  type ProjectLifecycleState,
} from "@flux/core/project-lifecycle-state";
import { ProjectLifecycleBadge } from "@/src/components/projects/project-lifecycle-badge";

type LifecycleInfo = {
  slug: string;
  hash: string;
  name: string;
  lifecycleState: ProjectLifecycleState;
  summary: string;
  activeCount: number;
  activeLimit: number;
  plan: "hobby" | "pro";
};

type Props = {
  slug: string;
  hash: string;
  onLifecycleChange?: (state: ProjectLifecycleState) => void;
};

export function ProjectLifecyclePanel({
  slug,
  hash,
  onLifecycleChange,
}: Props) {
  const [info, setInfo] = useState<LifecycleInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<ProjectLifecycleAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/lifecycle?hash=${encodeURIComponent(hash)}`,
      );
      const body = (await res.json()) as {
        lifecycle?: LifecycleInfo;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `Request failed (${String(res.status)})`);
      }
      setInfo(body.lifecycle ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load lifecycle.");
    } finally {
      setLoading(false);
    }
  }, [hash, slug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runAction(action: ProjectLifecycleAction): Promise<void> {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/lifecycle?hash=${encodeURIComponent(hash)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      const body = (await res.json()) as {
        lifecycle?: LifecycleInfo;
        lifecycleState?: ProjectLifecycleState;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `Request failed (${String(res.status)})`);
      }
      if (body.lifecycle) setInfo(body.lifecycle);
      if (body.lifecycleState) onLifecycleChange?.(body.lifecycleState);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lifecycle action failed.");
    } finally {
      setBusy(null);
    }
  }

  const state = info?.lifecycleState ?? "active";

  return (
    <section
      className="rounded-md border border-zinc-200/70 bg-white/60 p-4 dark:border-zinc-800/60 dark:bg-zinc-950/30"
      aria-label="Project lifecycle"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Lifecycle
          </h4>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">
            Active projects serve API traffic and count toward your plan limit.
            Dormant and archived projects keep data; wake to resume traffic.
          </p>
        </div>
        {!loading && info ? (
          <ProjectLifecycleBadge state={info.lifecycleState} />
        ) : null}
      </div>

      {loading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading…
        </p>
      ) : info ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            {info.summary}
          </p>
          <p className="font-mono text-xs text-zinc-500">
            Active {String(info.activeCount)} / {String(info.activeLimit)}
            {info.plan === "hobby" ? " (Hobby)" : " (Pro)"}
          </p>
          <div className="flex flex-wrap gap-2">
            {state !== "active" ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void runAction("wake")}
                className="rounded-md border border-emerald-300/80 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
              >
                {busy === "wake" ? "Waking…" : "Wake project"}
              </button>
            ) : null}
            {state === "active" ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void runAction("sleep")}
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
              >
                {busy === "sleep" ? "Sleeping…" : "Put to sleep"}
              </button>
            ) : null}
            {state !== "archived" ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void runAction("archive")}
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
              >
                {busy === "archive" ? "Archiving…" : "Archive"}
              </button>
            ) : null}
          </div>
          {state !== "active" ? (
            <p className="text-xs text-amber-800/90 dark:text-amber-200/80">
              Tenant API requests return 503 while {lifecycleStateLabel(state).toLowerCase()}.
              Dashboard inspection, backups, and CLI control-plane tools still work.
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </section>
  );
}

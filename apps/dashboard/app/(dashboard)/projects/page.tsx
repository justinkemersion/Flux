"use client";

import { Loader2, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type ProjectRow = {
  slug: string;
  status: "running" | "stopped" | "partial";
  apiUrl: string;
  postgresConnectionString: string | null;
  ownerId: string;
};

function statusLabel(s: ProjectRow["status"]): string {
  switch (s) {
    case "running":
      return "Running";
    case "stopped":
      return "Stopped";
    default:
      return "Partial";
  }
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed (${String(res.status)})`);
      }
      const data = (await res.json()) as { projects: ProjectRow[] };
      setProjects(data.projects);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openDialog(): void {
    setCreateError(null);
    setName("");
    dialogRef.current?.showModal();
  }

  function closeDialog(): void {
    dialogRef.current?.close();
  }

  async function onCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : `Create failed (${String(res.status)})`;
        throw new Error(msg);
      }
      closeDialog();
      setName("");
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Manage your Flux database projects
          </p>
        </div>
        <button
          type="button"
          onClick={openDialog}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
          aria-label="Create project"
        >
          <Plus className="h-5 w-5" />
        </button>
      </header>

      {fetching ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
        </div>
      ) : loadError ? (
        <p className="text-red-600 dark:text-red-400">{loadError}</p>
      ) : projects.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No projects yet. Use the plus button to create one.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <article
              key={p.slug}
              className="flex flex-col rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="font-mono text-sm font-semibold">{p.slug}</h2>
                <span
                  className={
                    p.status === "running"
                      ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                      : p.status === "stopped"
                        ? "rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100"
                        : "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-100"
                  }
                >
                  {statusLabel(p.status)}
                </span>
              </div>
              <dl className="flex flex-col gap-2 text-xs">
                <div>
                  <dt className="text-zinc-500 dark:text-zinc-400">API URL</dt>
                  <dd className="mt-0.5 break-all font-mono text-[11px] text-zinc-900 dark:text-zinc-100">
                    {p.apiUrl}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500 dark:text-zinc-400">Postgres</dt>
                  <dd className="mt-0.5 break-all font-mono text-[11px] text-zinc-900 dark:text-zinc-100">
                    {p.postgresConnectionString ??
                      "Unavailable while Postgres is stopped"}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}

      <dialog
        ref={dialogRef}
        className="open:backdrop:bg-black/50 w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-lg backdrop:bg-zinc-900/40 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <h2 className="text-lg font-semibold">New project</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Provisions Postgres and PostgREST (this may take a minute).
        </p>
        <form onSubmit={(e) => void onCreate(e)} className="mt-4">
          <label htmlFor="project-name" className="block text-sm font-medium">
            Name
          </label>
          <input
            id="project-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            placeholder="my-app"
            required
            disabled={creating}
          />
          {createError ? (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">
              {createError}
            </p>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeDialog}
              className="rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              disabled={creating}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

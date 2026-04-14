"use client";

import {
  AlertTriangle,
  Database,
  Globe,
  Loader2,
  Play,
  Plus,
  Settings,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
} from "react";

type ServerStatus = "running" | "stopped" | "partial";

type ProjectRow = {
  id: string;
  name: string;
  slug: string;
  status: ServerStatus;
  apiUrl: string;
  postgresConnectionString: string | null;
  createdAt: string;
};

type DisplayStatus = ServerStatus | "transitioning";

function StatusBadge({ status }: { status: DisplayStatus }) {
  const base =
    "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium";
  switch (status) {
    case "running":
      return (
        <span
          className={`${base} bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200`}
        >
          <span
            className="h-1.5 w-1.5 rounded-full bg-emerald-500"
            aria-hidden
          />
          Online
        </span>
      );
    case "stopped":
      return (
        <span
          className={`${base} bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100`}
        >
          <span
            className="h-1.5 w-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500"
            aria-hidden
          />
          Offline
        </span>
      );
    case "transitioning":
      return (
        <span
          className={`${base} bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200`}
        >
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          Transitioning
        </span>
      );
    default:
      return (
        <span
          className={`${base} bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
          Partial
        </span>
      );
  }
}

type ProjectCardProps = {
  project: ProjectRow;
  onDelete: () => void;
};

function ProjectCard({ project: p, onDelete }: ProjectCardProps) {
  const [isBusy, setIsBusy] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<DisplayStatus>(p.status);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!isBusy) {
      setCurrentStatus(p.status);
    }
  }, [p.status, isBusy]);

  useEffect(() => {
    if (!deleteOpen) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setDeleteOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [deleteOpen]);

  useEffect(() => {
    if (!deleteOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [deleteOpen]);

  async function togglePower(): Promise<void> {
    if (isBusy || currentStatus === "partial") return;
    const action = currentStatus === "running" ? "stop" : "start";
    setIsBusy(true);
    setActionError(null);
    setCurrentStatus("transitioning");
    try {
      const res = await fetch(`/api/projects/${p.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Action failed (${String(res.status)})`);
      }
      setCurrentStatus(action === "start" ? "running" : "stopped");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      setCurrentStatus(p.status);
    } finally {
      setIsBusy(false);
    }
  }

  function openDeleteModal(): void {
    setDeleteConfirm("");
    setDeleteError(null);
    setDeleteOpen(true);
  }

  function closeDeleteModal(): void {
    if (isDeleting) return;
    setDeleteOpen(false);
  }

  async function handleDelete(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (deleteConfirm !== p.name) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/projects/${p.slug}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Delete failed (${String(res.status)})`);
      }
      setDeleteOpen(false);
      onDelete();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeleting(false);
    }
  }

  const canToggle =
    !isBusy &&
    currentStatus !== "transitioning" &&
    currentStatus !== "partial";

  return (
    <>
      <article className="flex flex-col rounded-xl border border-zinc-200/80 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-zinc-900 dark:text-zinc-50">
              {p.name}
            </h2>
            <p className="mt-0.5 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
              {p.slug}
            </p>
          </div>
          <StatusBadge status={currentStatus} />
        </header>

        <div className="mt-4 flex flex-col gap-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
              API URL
            </p>
            <div className="flex min-w-0 items-start gap-2 overflow-hidden rounded-md bg-gray-50 p-2 dark:bg-zinc-900/60">
              <Globe
                className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-800 dark:text-zinc-200">
                {p.apiUrl}
              </span>
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Postgres
            </p>
            <div className="flex min-w-0 items-start gap-2 overflow-hidden rounded-md bg-gray-50 p-2 dark:bg-zinc-900/60">
              <Database
                className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-800 dark:text-zinc-200">
                {p.postgresConnectionString ??
                  "Unavailable while Postgres is stopped"}
              </span>
            </div>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Created{" "}
            <time dateTime={p.createdAt}>
              {new Date(p.createdAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </time>
          </p>
        </div>

        {actionError ? (
          <p
            className="mt-3 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-400"
            role="alert"
          >
            {actionError}
          </p>
        ) : null}

        <footer className="mt-4 flex items-center justify-between border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => void togglePower()}
            disabled={!canToggle}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label={
              currentStatus === "running" ? `Stop ${p.name}` : `Start ${p.name}`
            }
            title={currentStatus === "running" ? "Stop project" : "Start project"}
          >
            {isBusy || currentStatus === "transitioning" ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            ) : currentStatus === "running" ? (
              <Square className="h-5 w-5" aria-hidden />
            ) : (
              <Play className="h-5 w-5" aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={openDeleteModal}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label={`Project settings for ${p.name}`}
            title="Settings"
          >
            <Settings className="h-5 w-5" aria-hidden />
          </button>
        </footer>
      </article>

      {deleteOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={closeDeleteModal}
        >
          <div
            className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-zinc-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`delete-title-${p.id}`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeDeleteModal}
              disabled={isDeleting}
              className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
              aria-label="Close"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>

            <div className="pr-10">
              <div className="mb-4 flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-950">
                  <AlertTriangle
                    className="h-5 w-5 text-red-600 dark:text-red-400"
                    aria-hidden
                  />
                </div>
                <div className="min-w-0">
                  <h2
                    id={`delete-title-${p.id}`}
                    className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
                  >
                    Delete project
                  </h2>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    This permanently destroys all containers and database volumes
                    for{" "}
                    <strong className="text-zinc-900 dark:text-zinc-100">
                      {p.name}
                    </strong>
                    . This action cannot be undone.
                  </p>
                </div>
              </div>

              <form onSubmit={(e) => void handleDelete(e)}>
                <label
                  htmlFor={`delete-confirm-${p.id}`}
                  className="block text-sm font-medium text-zinc-900 dark:text-zinc-100"
                >
                  Type{" "}
                  <span className="font-mono font-semibold">{p.name}</span> to
                  confirm
                </label>
                <input
                  id={`delete-confirm-${p.id}`}
                  type="text"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none ring-zinc-200 transition-shadow focus:border-blue-500 focus:ring-2 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-950 dark:ring-zinc-800"
                  placeholder={p.name}
                  autoComplete="off"
                  disabled={isDeleting}
                />

                {deleteError ? (
                  <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                    {deleteError}
                  </p>
                ) : null}

                <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
                  <button
                    type="button"
                    onClick={closeDeleteModal}
                    disabled={isDeleting}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={deleteConfirm !== p.name || isDeleting}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-700 dark:hover:bg-red-600"
                  >
                    {isDeleting ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="h-4 w-4" aria-hidden />
                    )}
                    {isDeleting ? "Deleting…" : "Delete project"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default function ProjectsPage() {
  const [projectList, setProjectList] = useState<ProjectRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
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
      setProjectList(data.projects);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      void load();
    }, 5000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!createOpen) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setCreateOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [createOpen]);

  useEffect(() => {
    if (!createOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [createOpen]);

  function openCreateModal(): void {
    setCreateError(null);
    setName("");
    setCreateOpen(true);
  }

  function closeCreateModal(): void {
    if (creating) return;
    setCreateOpen(false);
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
      setCreateOpen(false);
      setName("");
      setFetching(true);
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  function handleProjectDeleted(slug: string): void {
    setProjectList((prev) => prev.filter((p) => p.slug !== slug));
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Projects
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Manage your Flux database projects
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-900 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
          aria-label="Create project"
        >
          <Plus className="h-5 w-5" aria-hidden />
        </button>
      </header>

      {fetching ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
        </div>
      ) : loadError ? (
        <p className="text-red-600 dark:text-red-400">{loadError}</p>
      ) : projectList.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No projects yet. Use the plus button to create one.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {projectList.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onDelete={() => handleProjectDeleted(p.slug)}
            />
          ))}
        </div>
      )}

      {createOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={closeCreateModal}
        >
          <div
            className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-zinc-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-project-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeCreateModal}
              disabled={creating}
              className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
              aria-label="Close"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>

            <div className="pr-10">
              <h2
                id="create-project-title"
                className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
              >
                New project
              </h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Provisions Postgres and PostgREST (this may take a minute).
              </p>
              <form onSubmit={(e) => void onCreate(e)} className="mt-6">
                <label
                  htmlFor="project-name"
                  className="block text-sm font-medium text-zinc-900 dark:text-zinc-100"
                >
                  Name
                </label>
                <input
                  id="project-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none transition-shadow focus:border-blue-500 focus:ring-2 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-950"
                  placeholder="my-app"
                  required
                  disabled={creating}
                />
                {createError ? (
                  <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                    {createError}
                  </p>
                ) : null}
                <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
                  <button
                    type="button"
                    onClick={closeCreateModal}
                    disabled={creating}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creating}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    {creating ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : null}
                    {creating ? "Creating…" : "Create"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

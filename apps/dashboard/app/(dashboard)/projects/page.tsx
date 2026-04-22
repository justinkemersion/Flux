"use client";

import {
  AlertTriangle,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import { useSession } from "next-auth/react";
import {
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  HOBBY_LIMIT_API_MESSAGE,
  PRO_LIMIT_API_MESSAGE,
  ProjectCard,
  type ProjectRow,
} from "@/src/components/projects/project-card";
import {
  hashSegment,
  projectApiInterface,
  uptimeReadoutForStatus,
} from "@/src/lib/routing-identity";

const focusable =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 dark:focus-visible:ring-zinc-500/35 dark:focus-visible:ring-offset-zinc-950";

const thSpec =
  "border-b border-zinc-200 px-3 py-2.5 text-left text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400";

const tdSpec =
  "border-b border-zinc-200 px-3 py-3 align-middle text-sm text-zinc-700 dark:border-zinc-800 dark:text-zinc-300";

const rowActionClass = `shrink-0 rounded-md bg-transparent px-2 py-1.5 text-xs font-medium text-zinc-600 transition-colors enabled:hover:bg-zinc-100 enabled:hover:text-zinc-900 enabled:focus-visible:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:enabled:hover:bg-zinc-800 dark:enabled:hover:text-zinc-100 dark:enabled:focus-visible:text-zinc-100 ${focusable}`;

export default function ProjectsPage() {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? "—";

  const [projectList, setProjectList] = useState<ProjectRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createLimitBanner, setCreateLimitBanner] = useState<
    "hobby" | "pro" | null
  >(null);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [userPlan, setUserPlan] = useState<"hobby" | "pro" | null>(null);
  const [detailSlug, setDetailSlug] = useState<string | null>(null);
  const [rowActionBusy, setRowActionBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed (${String(res.status)})`);
      }
      const data = (await res.json()) as {
        projects: ProjectRow[];
        plan?: "hobby" | "pro";
      };
      setProjectList((prev) => {
        const prevBySlug = new Map(prev.map((x) => [x.slug, x]));
        return data.projects.map((p) => {
          const old = prevBySlug.get(p.slug);
          return {
            ...p,
            anonKey: old?.anonKey,
            serviceRoleKey: old?.serviceRoleKey,
            postgresConnectionString: old?.postgresConnectionString,
          };
        });
      });
      setUserPlan(data.plan === "pro" ? "pro" : "hobby");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching(false);
    }
  }, []);

  function handleCredentialsRevealed(
    slug: string,
    creds: {
      anonKey: string;
      serviceRoleKey: string;
      postgresConnectionString: string;
    },
  ): void {
    setProjectList((prev) =>
      prev.map((p) =>
        p.slug === slug
          ? {
              ...p,
              anonKey: creds.anonKey,
              serviceRoleKey: creds.serviceRoleKey,
              postgresConnectionString: creds.postgresConnectionString,
            }
          : p,
      ),
    );
  }

  function handleProjectRepaired(slug: string): void {
    setProjectList((prev) =>
      prev.map((p) =>
        p.slug === slug
          ? {
              ...p,
              anonKey: undefined,
              serviceRoleKey: undefined,
              postgresConnectionString: undefined,
            }
          : p,
      ),
    );
    void load();
  }

  function handleSettingsSavedClearCredentials(slug: string): void {
    setProjectList((prev) =>
      prev.map((p) =>
        p.slug === slug
          ? {
              ...p,
              anonKey: undefined,
              serviceRoleKey: undefined,
              postgresConnectionString: undefined,
            }
          : p,
      ),
    );
    void load();
  }

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

  useEffect(() => {
    if (!detailSlug) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [detailSlug]);

  function openCreateModal(): void {
    setCreateError(null);
    setCreateLimitBanner(null);
    setBillingError(null);
    setName("");
    setCreateOpen(true);
  }

  function closeCreateModal(): void {
    if (creating || upgradeLoading) return;
    setCreateOpen(false);
  }

  async function startProCheckout(): Promise<void> {
    setUpgradeLoading(true);
    setBillingError(null);
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        url?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? `Checkout failed (${String(res.status)})`);
      }
      if (typeof data.url === "string") {
        window.location.href = data.url;
        return;
      }
      throw new Error("No checkout URL returned");
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpgradeLoading(false);
    }
  }

  async function onCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    setCreateLimitBanner(null);
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
        if (res.status === 403 && msg === HOBBY_LIMIT_API_MESSAGE) {
          setCreateLimitBanner("hobby");
          return;
        }
        if (res.status === 403 && msg === PRO_LIMIT_API_MESSAGE) {
          setCreateLimitBanner("pro");
          return;
        }
        throw new Error(msg);
      }
      setCreateOpen(false);
      setName("");
      setCreateLimitBanner(null);
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
    if (detailSlug === slug) setDetailSlug(null);
  }

  async function runRepairFromTable(slug: string): Promise<void> {
    if (
      !window.confirm(
        "Repair removes any Docker containers and volumes for this project, then provisions a new empty stack. All previous database data on the host is lost. Continue?",
      )
    ) {
      return;
    }
    setRowActionBusy(slug);
    try {
      const res = await fetch(`/api/projects/${slug}/repair`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? `Repair failed (${String(res.status)})`);
      }
      setDetailSlug(null);
      await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setRowActionBusy(null);
    }
  }

  async function stopFromTable(slug: string): Promise<void> {
    const p = projectList.find((x) => x.slug === slug);
    if (!p) return;
    if (p.status !== "running" && p.status !== "partial") return;
    setRowActionBusy(slug);
    try {
      const res = await fetch(`/api/projects/${p.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Stop failed (${String(res.status)})`);
      }
      await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setRowActionBusy(null);
    }
  }

  const detailProject = detailSlug
    ? projectList.find((p) => p.slug === detailSlug)
    : undefined;

  return (
    <div className="flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-10 sm:px-8 sm:py-14">
      <div className="border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          Signed in as{" "}
          <span className="font-medium text-zinc-800 dark:text-zinc-300">
            user_{userId}
          </span>
        </p>
      </div>

      <div className="mb-0 flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <h1
            className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-2xl"
            id="fleet-spec"
          >
            Projects
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
            Tenant databases and APIs
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {userPlan === "hobby" ? (
            <button
              type="button"
              onClick={() => void startProCheckout()}
              disabled={upgradeLoading}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-800 shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
            >
              {upgradeLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {upgradeLoading ? "Redirecting…" : "Upgrade to Pro"}
            </button>
          ) : userPlan === "pro" ? (
            <span className="inline-flex h-10 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-xs font-medium text-emerald-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-emerald-400">
              Pro
            </span>
          ) : null}
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600 shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Create project"
          >
            <Plus className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </div>

      {billingError && !createOpen ? (
        <p
          className="mb-2 rounded border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300"
          role="alert"
        >
          {billingError}
        </p>
      ) : null}

      {fetching ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
        </div>
      ) : loadError ? (
        <p className="text-red-400">{loadError}</p>
      ) : projectList.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          No projects yet. Create one with the plus button.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table
            className="w-full min-w-[58rem] border-collapse text-left text-sm"
            aria-labelledby="fleet-spec"
          >
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900/40">
                <th scope="col" className={thSpec}>
                  #
                </th>
                <th scope="col" className={thSpec}>
                  Project
                </th>
                <th scope="col" className={thSpec}>
                  API
                </th>
                <th scope="col" className={thSpec}>
                  Uptime
                </th>
                <th scope="col" className={`${thSpec} w-[1%] text-right`}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {projectList.map((p, i) => {
                const hash = hashSegment(`${p.slug}:${p.id}`);
                const specHost = projectApiInterface(p.slug, hash);
                const busy = rowActionBusy === p.slug;
                return (
                  <tr key={p.id}>
                    <td className={tdSpec}>
                      <span className="text-[10px] text-zinc-500 sm:text-xs">
                        {`#${String(i + 1).padStart(2, "0")}`}
                      </span>
                    </td>
                    <td className={tdSpec}>
                      <span className="text-zinc-900 dark:text-zinc-100">
                        {p.slug}
                      </span>
                      <span className="text-zinc-400 dark:text-zinc-600">
                        {" "}
                        ·{" "}
                      </span>
                      <span className="font-mono text-xs text-zinc-500 dark:text-zinc-500">
                        {hash}
                      </span>
                    </td>
                    <td className={tdSpec}>
                      <code
                        className="block max-w-[18rem] truncate rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 font-mono text-[10px] text-zinc-700 sm:max-w-[20rem] sm:text-[11px] dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300"
                        title={p.apiUrl}
                      >
                        {p.apiUrl || specHost}
                      </code>
                    </td>
                    <td className={tdSpec}>
                      <span
                        className={`inline-block min-w-[4.5rem] rounded-md border px-2 py-1.5 text-center text-xs tabular-nums ${
                          p.status === "running"
                            ? "border-emerald-200/80 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
                            : "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-500"
                        }`}
                      >
                        {uptimeReadoutForStatus(p.status)}
                      </span>
                    </td>
                    <td
                      className={`${tdSpec} w-[1%] whitespace-nowrap text-right`}
                    >
                      <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
                        <button
                          type="button"
                          onClick={() => setDetailSlug(p.slug)}
                          className={rowActionClass}
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runRepairFromTable(p.slug)}
                          className={rowActionClass}
                        >
                          Repair
                        </button>
                        <button
                          type="button"
                          disabled={
                            busy ||
                            (p.status !== "running" && p.status !== "partial")
                          }
                          onClick={() => void stopFromTable(p.slug)}
                          className={rowActionClass}
                        >
                          Stop
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {detailSlug && detailProject ? (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-10 backdrop-blur-sm"
          role="presentation"
          onClick={() => setDetailSlug(null)}
        >
          <div
            className="relative w-full max-w-2xl pb-20"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setDetailSlug(null)}
              className="absolute -right-1 -top-1 z-10 inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-500 shadow-sm transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-100"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
            <ProjectCard
              key={detailProject.id}
              project={detailProject}
              onDelete={() => {
                handleProjectDeleted(detailProject.slug);
                setDetailSlug(null);
              }}
              onSettingsSaved={handleSettingsSavedClearCredentials}
              onCredentialsRevealed={handleCredentialsRevealed}
              onRepaired={() => handleProjectRepaired(detailProject.slug)}
            />
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={closeCreateModal}
        >
          <div
            className="relative w-full max-w-md rounded-md border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-project-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeCreateModal}
              disabled={creating}
              className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center text-zinc-500 transition-colors hover:text-zinc-200 disabled:opacity-50"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="pr-10">
              <h2
                id="create-project-title"
                className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
              >
                New project
              </h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
                Provisions Postgres and PostgREST (this may take a minute).
              </p>

              {createLimitBanner === "hobby" ? (
                <div
                  className="mt-5 flex flex-col gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40"
                  role="alert"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-800">
                      <AlertTriangle
                        className="h-5 w-5 text-zinc-600 dark:text-zinc-400"
                        aria-hidden
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        Free tier limit reached (2/2 projects).
                      </p>
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                        Delete a project or upgrade to create more.
                      </p>
                      {billingError ? (
                        <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                          {billingError}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void startProCheckout()}
                        disabled={upgradeLoading}
                        className="mt-3 inline-flex items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                      >
                        {upgradeLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : null}
                        {upgradeLoading ? "Redirecting…" : "Upgrade to Pro"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {createLimitBanner === "pro" ? (
                <div
                  className="mt-5 flex items-start gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40"
                  role="alert"
                >
                  <AlertTriangle
                    className="mt-0.5 h-5 w-5 shrink-0 text-zinc-500 dark:text-zinc-400"
                    aria-hidden
                  />
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    You&apos;ve reached the project limit for your Pro plan (10
                    projects).
                  </p>
                </div>
              ) : null}

              <form onSubmit={(e) => void onCreate(e)} className="mt-6">
                <label
                  htmlFor="project-name"
                  className="block text-sm font-medium text-zinc-900 dark:text-zinc-200"
                >
                  Name
                </label>
                <input
                  id="project-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-2 w-full rounded-md border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition-shadow focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500 dark:focus:ring-zinc-500/25"
                  placeholder="my-app"
                  required
                  disabled={creating}
                />
                {createError ? (
                  <p className="mt-2 text-sm text-red-400">{createError}</p>
                ) : null}
                <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
                  <button
                    type="button"
                    onClick={closeCreateModal}
                    disabled={creating}
                    className="rounded-md px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-60 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creating}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-200 bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
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

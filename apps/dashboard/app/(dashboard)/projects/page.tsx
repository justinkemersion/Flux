"use client";

import {
  AlertTriangle,
  Loader2,
  X,
} from "lucide-react";
import { useSession } from "next-auth/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  HOBBY_LIMIT_API_MESSAGE,
  PRO_LIMIT_API_MESSAGE,
  ProjectCard,
  type ProjectRow,
} from "@/src/components/projects/project-card";
import { FleetHealthGrid } from "@/src/components/fleet/fleet-health-grid";
import { ProjectMeshReadout } from "@/src/components/projects/project-mesh-readout";
import { ProjectsFleetBar } from "@/src/components/projects/projects-fleet-bar";
import { ProjectSummaryCard } from "@/src/components/projects/project-summary-card";

export default function ProjectsPage() {
  const { data: session } = useSession();
  const userSegment =
    session?.user?.githubLogin?.trim() ||
    session?.user?.id?.trim() ||
    "—";

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

  function closeProjectDetail(): void {
    setDetailSlug(null);
  }

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/projects");
      // Read body once. `res.json()` throws if the body is HTML (e.g. proxy) or not JSON — the
      // same symptom as "JSON.parse: unexpected character at line 1 column 1".
      const text = await res.text();
      let payload: unknown;
      try {
        payload = text.trim() ? (JSON.parse(text) as unknown) : null;
      } catch {
        throw new Error(
          "The projects API did not return valid JSON. If you use a reverse proxy, ensure /api is forwarded to this Next.js app, not a static file or other host.",
        );
      }
      if (!res.ok) {
        const msg =
          payload &&
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof (payload as { error: unknown }).error === "string"
            ? (payload as { error: string }).error
            : `Request failed (${String(res.status)})`;
        throw new Error(msg);
      }
      if (
        !payload ||
        typeof payload !== "object" ||
        !("projects" in payload) ||
        !Array.isArray((payload as { projects: unknown }).projects)
      ) {
        throw new Error(
          "Invalid response: expected JSON with a projects array.",
        );
      }
      const data = payload as {
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
    if (detailSlug === slug) closeProjectDetail();
  }

  const detailProject = detailSlug
    ? projectList.find((p) => p.slug === detailSlug)
    : undefined;

  const { fleetLine, fleetDegraded } = useMemo(() => {
    if (loadError) {
      return { fleetLine: "SYSTEM_FLEET_FAULT", fleetDegraded: true };
    }
    if (fetching && projectList.length === 0) {
      return { fleetLine: "SYSTEM_FLEET_SYNC", fleetDegraded: false };
    }
    const bad = projectList.some(
      (p) => p.status === "missing" || p.status === "corrupted",
    );
    if (bad) {
      return { fleetLine: "SYSTEM_FLEET_ATTENTION", fleetDegraded: true };
    }
    return { fleetLine: "SYSTEM_FLEET_NOMINAL", fleetDegraded: false };
  }, [loadError, fetching, projectList]);

  return (
    <div className="flex min-h-full w-full flex-1 flex-col bg-zinc-950 text-zinc-400">
      <ProjectsFleetBar
        userSegment={userSegment}
        fleetLine={fleetLine}
        fleetDegraded={fleetDegraded}
        onNewProject={openCreateModal}
      />

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-8 sm:py-10 lg:px-10">
        <FleetHealthGrid />
        <div className="mb-8 flex min-w-0 flex-wrap items-center justify-end gap-3">
          {userPlan === "hobby" ? (
            <button
              type="button"
              onClick={() => void startProCheckout()}
              disabled={upgradeLoading}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-700 bg-transparent px-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-900/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {upgradeLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : null}
              {upgradeLoading ? "Redirecting…" : "Upgrade_to_Pro"}
            </button>
          ) : userPlan === "pro" ? (
            <span className="inline-flex h-9 items-center rounded-md border border-zinc-800 bg-zinc-900/40 px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-400/90">
              PRO_TIER
            </span>
          ) : null}
        </div>

        {billingError && !createOpen ? (
          <p
            className="mb-6 rounded-md border border-red-900/50 bg-red-950/20 px-3 py-2 font-mono text-xs text-red-300"
            role="alert"
          >
            {billingError}
          </p>
        ) : null}

        {fetching ? (
          <div className="flex flex-1 justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-zinc-600" />
          </div>
        ) : loadError ? (
          <p className="font-mono text-sm text-red-400">{loadError}</p>
        ) : projectList.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center py-16 sm:py-24">
            <div className="flex w-full max-w-2xl flex-col items-center justify-center rounded-md border border-zinc-800 bg-transparent px-8 py-20 text-center sm:py-28">
              <p className="max-w-md font-mono text-xs uppercase leading-relaxed tracking-[0.2em] text-zinc-500">
                NO_RESOURCES_ALLOCATED.
                <br />
                AWAITING_PROVISIONING_COMMAND.
              </p>
            </div>
          </div>
        ) : (
          <ul
            className="grid list-none grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5"
            aria-label="Project fleet"
          >
            {projectList.map((p, i) => (
              <li key={p.id}>
                <ProjectSummaryCard
                  project={p}
                  staggerIndex={i}
                  onOpenDetail={() => {
                    setDetailSlug(p.slug);
                  }}
                  onRepaired={() => handleProjectRepaired(p.slug)}
                  onPowerChanged={() => void load()}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {detailSlug && detailProject ? (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/80 p-4 pt-20 backdrop-blur-sm"
          role="presentation"
          onClick={closeProjectDetail}
        >
          <div
            className="relative w-full max-w-4xl pb-20"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeProjectDetail}
              className="absolute -right-1 -top-1 z-10 inline-flex h-9 w-9 items-center justify-center border border-zinc-700 bg-zinc-950 font-mono text-xs text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-100"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
            <ProjectMeshReadout
              slug={detailProject.slug}
              hash={detailProject.hash}
            />
            <ProjectCard
              key={detailProject.id}
              project={detailProject}
              onDelete={() => {
                handleProjectDeleted(detailProject.slug);
                closeProjectDetail();
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
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={closeCreateModal}
        >
          <div
            className="relative w-full max-w-md rounded-md border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
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
                className="font-sans text-lg font-semibold text-zinc-100"
              >
                New project
              </h2>
              <p className="mt-1 font-mono text-xs text-zinc-500">
                Provisions Postgres and PostgREST (this may take a minute).
              </p>

              {createLimitBanner === "hobby" ? (
                <div
                  className="mt-5 flex flex-col gap-3 rounded-md border border-zinc-800 bg-zinc-900/40 p-4"
                  role="alert"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-800">
                      <AlertTriangle
                        className="h-5 w-5 text-zinc-400"
                        aria-hidden
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-zinc-100">
                        Free tier limit reached (2/2 projects).
                      </p>
                      <p className="mt-1 text-sm text-zinc-500">
                        Delete a project or upgrade to create more.
                      </p>
                      {billingError ? (
                        <p className="mt-2 text-sm text-red-400">
                          {billingError}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void startProCheckout()}
                        disabled={upgradeLoading}
                        className="mt-3 inline-flex items-center justify-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
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
                  className="mt-5 flex items-start gap-3 rounded-md border border-zinc-800 bg-zinc-900/40 p-4"
                  role="alert"
                >
                  <AlertTriangle
                    className="mt-0.5 h-5 w-5 shrink-0 text-zinc-500"
                    aria-hidden
                  />
                  <p className="text-sm text-zinc-400">
                    You&apos;ve reached the project limit for your Pro plan (10
                    projects).
                  </p>
                </div>
              ) : null}

              <form onSubmit={(e) => void onCreate(e)} className="mt-6">
                <label
                  htmlFor="project-name"
                  className="block text-sm font-medium text-zinc-200"
                >
                  Name
                </label>
                <input
                  id="project-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-2 w-full rounded-md border border-zinc-700 bg-black px-3 py-2.5 text-sm text-zinc-100 outline-none transition-shadow focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500/25"
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
                    className="rounded-md px-4 py-2 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creating}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-600 bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-white disabled:opacity-60"
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

"use client";

import { AlertTriangle, Loader2, RefreshCw, Trash2, Wrench } from "lucide-react";
import Link from "next/link";
import { MeshTelemetryPill } from "@/src/components/mesh-telemetry-pill";
import { EngineModeBadge } from "@/src/components/projects/engine-mode-badge";
import { ProjectHeader } from "@/src/components/projects/project-header";
import { type DisplayStatus } from "@/src/components/projects/project-status-badge";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  errorMessageFromJsonBody,
  readResponseJson,
} from "@/src/lib/fetch-json";
import { ProjectCardCliSnippetBlock } from "@/src/components/projects/project-card-cli-snippets";
import { ProjectCardConnectSection } from "@/src/components/projects/project-card-connect-section";
import { ProjectCardDeleteModal } from "@/src/components/projects/project-card-delete-modal";
import { ProjectCardFactoryResetModal } from "@/src/components/projects/project-card-factory-reset-modal";
import { ProjectCardSettingsModal } from "@/src/components/projects/project-card-settings-modal";
import { ProjectCardV1LogsPanel } from "@/src/components/projects/project-card-v1-logs-panel";
import { V2GettingStartedModal } from "@/src/components/projects/v2-getting-started-modal";
import type { ProjectRow } from "@/src/components/projects/project-types";
import {
  destructiveActionBlockedTitle,
  useProjectBackupTrust,
} from "@/src/lib/project-backup-trust-client";
export type { ProjectRow } from "@/src/components/projects/project-types";

export const HOBBY_LIMIT_API_MESSAGE =
  "Project limit reached. Please upgrade to Pro.";
export const PRO_LIMIT_API_MESSAGE =
  "Project limit reached (10 projects on Pro).";

type ProjectCardProps = {
  project: ProjectRow;
  onDelete: () => void;
  /** Called after JWT settings save so parents can drop cached credentials (keys change). */
  onSettingsSaved?: (slug: string) => void;
  onCredentialsRevealed: (
    slug: string,
    creds: {
      anonKey: string;
      serviceRoleKey: string;
      postgresConnectionString: string;
    },
  ) => void;
  /** After in-place repair/reconcile reprovisions the stack. */
  onRepaired?: () => void;
  /** When true (e.g. opened from list “Settings”), open the settings modal once on mount. */
  autoOpenSettings?: boolean;
  /**
   * When true, this card is rendered under `ProjectMeshReadout` in the same modal. Skip UI that
   * duplicates the mesh readout Connection panel and streaming logs.
   */
  meshReadoutCompanion?: boolean;
};

export function ProjectCard({
  project: p,
  onDelete,
  onSettingsSaved,
  onCredentialsRevealed,
  onRepaired,
  autoOpenSettings = false,
  meshReadoutCompanion = false,
}: ProjectCardProps) {
  const [isBusy, setIsBusy] = useState(false);
  const [powerIntent, setPowerIntent] = useState<"start" | "stop" | null>(
    null,
  );
  const [currentStatus, setCurrentStatus] = useState<DisplayStatus>(p.status);
  const [actionError, setActionError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [jwtSecretInput, setJwtSecretInput] = useState("");
  /** In-memory only: value just saved in this session so we can show reveal/copy (API never returns it). */
  const [lastSavedJwtSecret, setLastSavedJwtSecret] = useState<string | null>(
    null,
  );
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState(false);
  const [keysRotationNotice, setKeysRotationNotice] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [revealBusy, setRevealBusy] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [gettingStartedOpen, setGettingStartedOpen] = useState(false);
  const [logsService, setLogsService] = useState<"api" | "db">("api");
  const [logsText, setLogsText] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const didAutoOpenSettings = useRef(false);

  const isV2Shared = p.mode === "v2_shared";

  const {
    trust: backupTrust,
    loading: backupTrustLoading,
    error: backupTrustError,
    refresh: refreshBackupTrust,
  } = useProjectBackupTrust(p.hash);

  const destructiveBlocked =
    backupTrustLoading ||
    backupTrustError != null ||
    !backupTrust.allowsDestructiveWithoutOverride;

  const destructiveBlockedTitle = destructiveActionBlockedTitle(backupTrust, {
    loading: backupTrustLoading,
    fetchError: backupTrustError,
  });

  const canRevealCredentials =
    !isV2Shared &&
    (p.status === "running" ||
      p.status === "stopped" ||
      p.status === "partial");

  const credentialsLoaded =
    (p.anonKey?.length ?? 0) > 0 &&
    (p.serviceRoleKey?.length ?? 0) > 0 &&
    (p.postgresConnectionString?.length ?? 0) > 0;

  const connectSecretEmptyHint =
    !credentialsLoaded && canRevealCredentials
      ? "Click Load connection secrets to view."
      : undefined;

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
    if (!resetOpen) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setResetOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [resetOpen]);

  const closeSettingsModal = useCallback((): void => {
    if (settingsSaving) return;
    setSettingsOpen(false);
    setLastSavedJwtSecret(null);
    setJwtSecretInput("");
    setSettingsError(null);
    setSettingsSuccess(false);
  }, [settingsSaving]);

  const openSettingsModal = useCallback((): void => {
    setJwtSecretInput("");
    setLastSavedJwtSecret(null);
    setSettingsError(null);
    setSettingsSuccess(false);
    setSettingsOpen(true);
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!autoOpenSettings || didAutoOpenSettings.current || isV2Shared) return;
    didAutoOpenSettings.current = true;
    openSettingsModal();
  }, [autoOpenSettings, openSettingsModal, isV2Shared]);

  useEffect(() => {
    if (!settingsOpen) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") closeSettingsModal();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [settingsOpen, closeSettingsModal]);

  useEffect(() => {
    if (!deleteOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [deleteOpen]);

  useEffect(() => {
    if (!resetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [resetOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [settingsOpen]);

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    setLogsError(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(p.slug)}/logs?service=${logsService}`,
      );
      const data = (await readResponseJson(res, {
        apiLabel: "project logs API",
      })) as { error?: string; logs?: string } | null;
      if (!res.ok) {
        throw new Error(
          errorMessageFromJsonBody(
            data,
            `Request failed (${String(res.status)})`,
          ),
        );
      }
      setLogsText((data as { logs?: string } | null)?.logs ?? "");
    } catch (err) {
      setLogsError(err instanceof Error ? err.message : String(err));
    } finally {
      setLogsLoading(false);
    }
  }, [p.slug, logsService]);

  useEffect(() => {
    if (!logsOpen) return;
    void fetchLogs();
  }, [logsOpen, fetchLogs]);

  async function togglePower(): Promise<void> {
    if (isBusy || currentStatus === "partial") return;
    const action = currentStatus === "running" ? "stop" : "start";
    setIsBusy(true);
    setPowerIntent(action);
    setActionError(null);
    setCurrentStatus("transitioning");
    try {
      const res =
        action === "start"
          ? await fetch(
              `/api/projects/${encodeURIComponent(p.slug)}/start`,
              { method: "POST" },
            )
          : await fetch(`/api/projects/${encodeURIComponent(p.slug)}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "stop" as const }),
            });
      const data = (await readResponseJson(res, {
        apiLabel: "project power API",
      })) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(
          errorMessageFromJsonBody(
            data,
            `Action failed (${String(res.status)})`,
          ),
        );
      }
      setCurrentStatus(action === "start" ? "running" : "stopped");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      setCurrentStatus(p.status);
    } finally {
      setIsBusy(false);
      setPowerIntent(null);
    }
  }

  async function saveJwtSettings(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const trimmed = jwtSecretInput.trim();
    if (!trimmed) {
      setSettingsError("Enter a JWT secret (or webhook signing key).");
      return;
    }
    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsSuccess(false);
    try {
      const res = await fetch(`/api/projects/${p.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jwtSecret: trimmed }),
      });
      const data = (await readResponseJson(res, {
        apiLabel: "project settings API",
      })) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(
          errorMessageFromJsonBody(
            data,
            `Save failed (${String(res.status)})`,
          ),
        );
      }
      setSettingsSuccess(true);
      setLastSavedJwtSecret(trimmed);
      setJwtSecretInput("");
      setKeysRotationNotice(true);
      onSettingsSaved?.(p.slug);
      window.setTimeout(() => setSettingsSuccess(false), 4000);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingsSaving(false);
    }
  }

  function openDeleteModal(): void {
    if (destructiveBlocked) return;
    setDeleteConfirm("");
    setDeleteError(null);
    setDeleteOpen(true);
    void refreshBackupTrust();
  }

  function closeDeleteModal(): void {
    if (isDeleting) return;
    setDeleteOpen(false);
  }

  function openResetModal(): void {
    if (destructiveBlocked) return;
    setResetConfirm("");
    setResetError(null);
    setResetOpen(true);
    void refreshBackupTrust();
  }

  function closeResetModal(): void {
    if (resetBusy) return;
    setResetOpen(false);
  }

  async function runRepair(): Promise<void> {
    const confirmMsg = isV2Shared
      ? "Repair re-runs shared-cluster provisioning for this tenant (schema + role). This is for recovery when the catalog and cluster are out of sync. Continue?"
      : "Repair reconciles this project's Docker stack in place (restarts/adopts/recreates missing services) without deleting the Postgres data volume. Continue?";
    if (!window.confirm(confirmMsg)) {
      return;
    }
    setRepairBusy(true);
    setRepairError(null);
    try {
      const res = await fetch(`/api/projects/${p.slug}/repair`, {
        method: "POST",
      });
      const data = (await readResponseJson(res, {
        apiLabel: "project repair API",
      })) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(
          errorMessageFromJsonBody(
            data,
            `Repair failed (${String(res.status)})`,
          ),
        );
      }
      onRepaired?.();
    } catch (err) {
      setRepairError(err instanceof Error ? err.message : String(err));
    } finally {
      setRepairBusy(false);
    }
  }

  async function revealKeys(): Promise<void> {
    if (!canRevealCredentials) return;
    setRevealBusy(true);
    setRevealError(null);
    try {
      const res = await fetch(`/api/projects/${p.slug}/credentials`);
      const data = (await readResponseJson(res, {
        apiLabel: "project credentials API",
      })) as {
        error?: string;
        anonKey?: string;
        serviceRoleKey?: string;
        postgresConnectionString?: string;
      } | null;
      if (!res.ok) {
        throw new Error(
          errorMessageFromJsonBody(
            data,
            `Reveal failed (${String(res.status)})`,
          ),
        );
      }
      if (
        !data ||
        typeof data.anonKey !== "string" ||
        typeof data.serviceRoleKey !== "string" ||
        typeof data.postgresConnectionString !== "string"
      ) {
        throw new Error("Invalid credentials response");
      }
      onCredentialsRevealed(p.slug, {
        anonKey: data.anonKey,
        serviceRoleKey: data.serviceRoleKey,
        postgresConnectionString: data.postgresConnectionString,
      });
      setKeysRotationNotice(false);
    } catch (err) {
      setRevealError(err instanceof Error ? err.message : String(err));
    } finally {
      setRevealBusy(false);
    }
  }

  async function handleDelete(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (deleteConfirm !== p.name) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/projects/${p.slug}`, { method: "DELETE" });
      const data = (await readResponseJson(res, {
        apiLabel: "project delete API",
      })) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(
          errorMessageFromJsonBody(
            data,
            `Delete failed (${String(res.status)})`,
          ),
        );
      }
      setDeleteOpen(false);
      onDelete();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleFactoryReset(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const expected = `RESET ${p.name}`;
    if (resetConfirm !== expected) return;
    setResetBusy(true);
    setResetError(null);
    try {
      const res = await fetch(`/api/projects/${p.slug}/factory-reset`, {
        method: "POST",
      });
      const data = (await readResponseJson(res, {
        apiLabel: "project factory reset API",
      })) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(
          errorMessageFromJsonBody(
            data,
            `Factory reset failed (${String(res.status)})`,
          ),
        );
      }
      setResetOpen(false);
      onRepaired?.();
    } catch (err) {
      setResetError(err instanceof Error ? err.message : String(err));
    } finally {
      setResetBusy(false);
    }
  }

  const canToggle =
    !isBusy &&
    currentStatus !== "transitioning" &&
    currentStatus !== "partial" &&
    currentStatus !== "missing" &&
    currentStatus !== "corrupted";

  /** Stack state drives power; mesh `healthStatus` is in MeshTelemetryPill. */
  const showStartButton =
    !isV2Shared &&
    (currentStatus === "stopped" ||
      (currentStatus === "transitioning" && powerIntent === "start"));
  const showStopButton =
    !isV2Shared &&
    (currentStatus === "running" ||
      (currentStatus === "transitioning" && powerIntent === "stop"));

  const powerBtn =
    "inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-zinc-300/70 bg-white px-3 text-sm font-medium text-zinc-700 transition-[color,border-color,opacity] hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700/80 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";
  const powerStartBtn =
    "inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-emerald-300/80 bg-emerald-50 px-3 text-sm font-medium text-emerald-800 transition-[color,border-color,opacity] hover:border-emerald-400 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40 disabled:cursor-not-allowed disabled:opacity-40 dark:border-emerald-700/80 dark:bg-emerald-950/30 dark:text-emerald-200 dark:hover:bg-emerald-950/60";

  const logSourceBtn =
    "rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50";
  const logSourceActive =
    "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900";
  const logSourceIdle =
    "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800";

  return (
    <>
      <article className="flex flex-col rounded-md border border-zinc-200/70 bg-white p-6 shadow-sm dark:border-zinc-800/80 dark:bg-zinc-950">
        <ProjectHeader
          title={p.name}
          subtitle={p.slug}
          statusRow={
            <>
              <EngineModeBadge mode={p.mode} surface="lightHeader" />
              <MeshTelemetryPill
                healthStatus={p.healthStatus}
                lastHeartbeatAt={p.lastHeartbeatAt}
                createdAt={p.createdAt}
                stackStatus={p.status}
              />
            </>
          }
          primaryActions={
            <>
              <Link
                href={`/projects/${encodeURIComponent(p.slug)}`}
                className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                Open Console
              </Link>
              {!isV2Shared ? (
                <button
                  type="button"
                  onClick={openSettingsModal}
                  className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                  aria-label={`Project settings for ${p.name}`}
                >
                  Settings
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setGettingStartedOpen(true)}
                  className="inline-flex h-9 shrink-0 items-center rounded-md border border-zinc-300/70 bg-white px-3 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700/80 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                >
                  Getting Started
                </button>
              )}
            </>
          }
          secondaryActions={
            <>
              {currentStatus === "missing" ||
              currentStatus === "corrupted" ||
              (isV2Shared &&
                (p.healthStatus === "error" || p.healthStatus === "incomplete")) ? (
                <button
                  type="button"
                  onClick={() => void runRepair()}
                  disabled={repairBusy}
                  className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-orange-300 bg-orange-50 px-2.5 text-xs font-medium text-orange-950 transition-colors hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-100 dark:hover:bg-orange-900/50"
                >
                  {repairBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Wrench className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Repair
                </button>
              ) : null}
              {showStartButton ? (
                <button
                  type="button"
                  onClick={() => void togglePower()}
                  disabled={!canToggle && !(isBusy && powerIntent === "start")}
                  className={powerStartBtn}
                  title="Start project"
                  aria-label={`Start ${p.name}`}
                >
                  {isBusy && powerIntent === "start" ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      <span>Starting</span>
                    </span>
                  ) : (
                    "Start"
                  )}
                </button>
              ) : null}
              {showStopButton ? (
                <button
                  type="button"
                  onClick={() => void togglePower()}
                  disabled={!canToggle && !(isBusy && powerIntent === "stop")}
                  className={powerBtn}
                  title="Stop project"
                  aria-label={`Stop ${p.name}`}
                >
                  {isBusy && powerIntent === "stop" ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      <span>Stopping</span>
                    </span>
                  ) : (
                    "Stop"
                  )}
                </button>
              ) : null}
              <button
                type="button"
                onClick={openDeleteModal}
                disabled={destructiveBlocked}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-zinc-600 dark:text-zinc-400 dark:hover:bg-red-950/50 dark:hover:text-red-400 dark:disabled:hover:bg-transparent dark:disabled:hover:text-zinc-400"
                aria-label={
                  destructiveBlocked
                    ? `Delete project ${p.name} unavailable until backup is restore-verified`
                    : `Delete project ${p.name}`
                }
                title={
                  destructiveBlocked
                    ? destructiveBlockedTitle
                    : "Delete project"
                }
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </>
          }
        />

        {!meshReadoutCompanion || !isV2Shared ? (
          <ProjectCardConnectSection
            project={p}
            isV2Shared={isV2Shared}
            credentialsLoaded={credentialsLoaded}
            canRevealCredentials={canRevealCredentials}
            connectSecretEmptyHint={connectSecretEmptyHint}
            revealBusy={revealBusy}
            revealError={revealError}
            keysRotationNotice={keysRotationNotice}
            onRevealKeys={() => void revealKeys()}
          />
        ) : null}

        <div className="mt-8">
          <ProjectCardCliSnippetBlock
            slug={p.slug}
            hash={p.hash}
            v1Dedicated={!isV2Shared}
          />
        </div>

        {!isV2Shared && !meshReadoutCompanion ? (
          <ProjectCardV1LogsPanel
            logsOpen={logsOpen}
            logsService={logsService}
            logsText={logsText}
            logsLoading={logsLoading}
            logsError={logsError}
            logSourceBtn={logSourceBtn}
            logSourceActive={logSourceActive}
            logSourceIdle={logSourceIdle}
            onToggleOpen={() => setLogsOpen((open) => !open)}
            onSetService={setLogsService}
            onRefresh={() => void fetchLogs()}
          />
        ) : null}

        <p className="mt-6 border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Created{" "}
          <time dateTime={p.createdAt}>
            {new Date(p.createdAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </time>
        </p>

        {repairError ? (
          <p
            className="mt-3 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-400"
            role="alert"
          >
            {repairError}
          </p>
        ) : null}

        {actionError ? (
          <p
            className="mt-3 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-400"
            role="alert"
          >
            {actionError}
          </p>
        ) : null}
      </article>

      <ProjectCardSettingsModal
        open={settingsOpen}
        mounted={mounted}
        project={p}
        isV2Shared={isV2Shared}
        jwtSecretInput={jwtSecretInput}
        onJwtSecretInputChange={setJwtSecretInput}
        lastSavedJwtSecret={lastSavedJwtSecret}
        onClearLastSavedJwtSecret={() => {
          setLastSavedJwtSecret(null);
          setJwtSecretInput("");
        }}
        settingsSaving={settingsSaving}
        settingsError={settingsError}
        settingsSuccess={settingsSuccess}
        destructiveBlocked={destructiveBlocked}
        destructiveBlockedTitle={destructiveBlockedTitle}
        onOpenFactoryReset={openResetModal}
        onClose={closeSettingsModal}
        onSubmit={(e) => void saveJwtSettings(e)}
      />

      <ProjectCardDeleteModal
        open={deleteOpen}
        mounted={mounted}
        project={p}
        isV2Shared={isV2Shared}
        backupTrust={backupTrust}
        backupTrustLoading={backupTrustLoading}
        backupTrustError={backupTrustError}
        onRefreshBackupTrust={() => void refreshBackupTrust()}
        deleteConfirm={deleteConfirm}
        onDeleteConfirmChange={setDeleteConfirm}
        isDeleting={isDeleting}
        deleteError={deleteError}
        destructiveBlocked={destructiveBlocked}
        onClose={closeDeleteModal}
        onSubmit={(e) => void handleDelete(e)}
      />

      <ProjectCardFactoryResetModal
        open={resetOpen}
        mounted={mounted}
        project={p}
        backupTrust={backupTrust}
        backupTrustLoading={backupTrustLoading}
        backupTrustError={backupTrustError}
        onRefreshBackupTrust={() => void refreshBackupTrust()}
        resetConfirm={resetConfirm}
        onResetConfirmChange={setResetConfirm}
        resetBusy={resetBusy}
        resetError={resetError}
        destructiveBlocked={destructiveBlocked}
        onClose={closeResetModal}
        onSubmit={(e) => void handleFactoryReset(e)}
      />

      <V2GettingStartedModal
        open={isV2Shared && gettingStartedOpen}
        onClose={() => setGettingStartedOpen(false)}
        apiUrl={p.apiUrl}
        slug={p.slug}
        hash={p.hash}
      />
    </>
  );
}

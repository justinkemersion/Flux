"use client";

import {
  AlertTriangle,
  Check,
  Clipboard,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Settings,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { MeshTelemetryPill } from "@/src/components/mesh-telemetry-pill";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

type ServerStatus =
  | "running"
  | "stopped"
  | "partial"
  | "missing"
  | "corrupted";

export type ProjectRow = {
  id: string;
  name: string;
  slug: string;
  /** Catalog / Docker stack hash (7 hex), required for CLI `--hash` and hostnames. */
  hash: string;
  status: ServerStatus;
  apiUrl: string;
  createdAt: string;
  /** Mesh probe (2m) — from flux-system. */
  healthStatus?: string | null;
  lastHeartbeatAt?: string | null;
  /** Loaded only after "Reveal keys" — not returned by list API. */
  anonKey?: string | null;
  serviceRoleKey?: string | null;
  postgresConnectionString?: string | null;
};

type DisplayStatus = ServerStatus | "transitioning";

export const HOBBY_LIMIT_API_MESSAGE =
  "Project limit reached. Please upgrade to Pro.";
export const PRO_LIMIT_API_MESSAGE =
  "Project limit reached (10 projects on Pro).";

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
          className={`${base} bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200`}
        >
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          Transitioning
        </span>
      );
    case "missing":
      return (
        <span
          className={`${base} bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200`}
        >
          <span
            className="h-1.5 w-1.5 rounded-full bg-red-500"
            aria-hidden
          />
          Missing
        </span>
      );
    case "corrupted":
      return (
        <span
          className={`${base} bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200`}
        >
          <span
            className="h-1.5 w-1.5 rounded-full bg-orange-500"
            aria-hidden
          />
          Drift
        </span>
      );
    case "partial":
      return (
        <span
          className={`${base} bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-orange-500" aria-hidden />
          Partial
        </span>
      );
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function CopyableField({
  label,
  value,
  isSecret,
  visuallyTruncate = false,
  prominent = false,
  emptyHint,
}: {
  label: string;
  value: string | null;
  isSecret: boolean;
  /** Single-line ellipsis for long non-secret values (e.g. anon JWT). */
  visuallyTruncate?: boolean;
  /** Larger type and padding for the “How to connect” section. */
  prominent?: boolean;
  /** Shown instead of “Unavailable” when the value is empty (e.g. secrets not loaded yet). */
  emptyHint?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const raw = value ?? "";
  const unavailable = raw.length === 0;
  const masked = isSecret && !revealed && !unavailable;
  const displayText = unavailable
    ? (emptyHint ?? "Unavailable")
    : masked
      ? "••••••••"
      : raw;
  const showEmptyHint = unavailable && Boolean(emptyHint);

  async function copy(): Promise<void> {
    if (unavailable) return;
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard denied */
    }
  }

  const labelCls = prominent
    ? "mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100"
    : "mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400";
  const boxCls = prominent
    ? "px-3 py-3 dark:bg-zinc-900/60"
    : "px-2 py-1.5 dark:bg-zinc-900/50";
  const valueCls = prominent
    ? "text-sm leading-snug"
    : "text-xs leading-relaxed";

  return (
    <div className="min-w-0">
      <p className={labelCls}>{label}</p>
      <div
        className={`flex min-w-0 items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50/90 dark:border-zinc-800 ${boxCls}`}
      >
        <span
          className={`min-w-0 flex-1 ${valueCls} ${
            showEmptyHint
              ? "font-sans italic text-zinc-500 dark:text-zinc-400"
              : `font-mono text-zinc-800 dark:text-zinc-200 ${
                  visuallyTruncate && !masked
                    ? "truncate"
                    : unavailable
                      ? "text-zinc-400 dark:text-zinc-500"
                      : "break-all"
                }`
          }`}
          title={unavailable || masked ? undefined : raw}
        >
          {displayText}
        </span>
        {isSecret && !unavailable ? (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200/80 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label={revealed ? "Hide value" : "Reveal value"}
            title={revealed ? "Hide" : "Reveal"}
          >
            {revealed ? (
              <EyeOff className="h-4 w-4" aria-hidden />
            ) : (
              <Eye className="h-4 w-4" aria-hidden />
            )}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void copy()}
          disabled={unavailable}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200/80 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label={`Copy ${label}`}
          title="Copy"
        >
          {copied ? (
            <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
          ) : (
            <Clipboard className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>
    </div>
  );
}

function CliSnippetBlock({ slug, hash }: { slug: string; hash: string }) {
  const line = `flux push ./migrations/schema.sql --project ${slug} --hash ${hash}`;
  const [copied, setCopied] = useState(false);

  async function copyLine(): Promise<void> {
    try {
      await navigator.clipboard.writeText(line);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard denied */
    }
  }

  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/30">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        CLI snippet
      </h3>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        <code className="font-mono text-[11px]">--hash</code> is the stack id: it
        matches Docker resources{" "}
        <code className="font-mono text-[11px]">flux-{"{hash}"}-{"{slug}"}-*</code>{" "}
        and the hash shown on the project card. Use it when the CLI cannot resolve
        the project from flux-system (for example remote Docker or missing{" "}
        <code className="font-mono text-[11px]">FLUX_OWNER_KEY</code>). Swap in
        your SQL file path.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border border-zinc-200 bg-white px-3 py-2.5 font-mono text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
          {line}
        </pre>
        <button
          type="button"
          onClick={() => void copyLine()}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {copied ? (
            <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
          ) : (
            <Clipboard className="h-4 w-4" aria-hidden />
          )}
          Copy
        </button>
      </div>
    </div>
  );
}

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
  /** After destructive repair reprovisions the stack. */
  onRepaired?: () => void;
  /** When true (e.g. opened from list “Settings”), open the settings modal once on mount. */
  autoOpenSettings?: boolean;
};

export function ProjectCard({
  project: p,
  onDelete,
  onSettingsSaved,
  onCredentialsRevealed,
  onRepaired,
  autoOpenSettings = false,
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [revealBusy, setRevealBusy] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsService, setLogsService] = useState<"api" | "db">("api");
  const [logsText, setLogsText] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const didAutoOpenSettings = useRef(false);

  const canRevealCredentials =
    p.status === "running" ||
    p.status === "stopped" ||
    p.status === "partial";

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
    if (!autoOpenSettings || didAutoOpenSettings.current) return;
    didAutoOpenSettings.current = true;
    openSettingsModal();
  }, [autoOpenSettings, openSettingsModal]);

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
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        logs?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? `Request failed (${String(res.status)})`);
      }
      setLogsText(data.logs ?? "");
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
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? `Save failed (${String(res.status)})`);
      }
      setSettingsSuccess(true);
      setLastSavedJwtSecret(trimmed);
      setJwtSecretInput("");
      onSettingsSaved?.(p.slug);
      window.setTimeout(() => setSettingsSuccess(false), 4000);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingsSaving(false);
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

  async function runRepair(): Promise<void> {
    if (
      !window.confirm(
        "Repair removes any Docker containers and volumes for this project, then provisions a new empty stack. All previous database data on the host is lost. Continue?",
      )
    ) {
      return;
    }
    setRepairBusy(true);
    setRepairError(null);
    try {
      const res = await fetch(`/api/projects/${p.slug}/repair`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? `Repair failed (${String(res.status)})`);
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
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        anonKey?: string;
        serviceRoleKey?: string;
        postgresConnectionString?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? `Reveal failed (${String(res.status)})`);
      }
      if (
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
    currentStatus !== "partial" &&
    currentStatus !== "missing" &&
    currentStatus !== "corrupted";

  /** Stack state drives power; mesh `healthStatus` is in MeshTelemetryPill. */
  const showStartButton =
    currentStatus === "stopped" ||
    (currentStatus === "transitioning" && powerIntent === "start");
  const showStopButton =
    currentStatus === "running" ||
    (currentStatus === "transitioning" && powerIntent === "stop");

  const powerBtn =
    "inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-300 transition-[color,border-color,opacity] hover:border-zinc-500 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700";
  const powerStartBtn =
    "inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-emerald-600/80 bg-zinc-900 px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-emerald-400 transition-[color,border-color,opacity] hover:border-emerald-500 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 disabled:cursor-not-allowed disabled:opacity-40";

  const logSourceBtn =
    "rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50";
  const logSourceActive =
    "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900";
  const logSourceIdle =
    "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800";

  return (
    <>
      <article className="flex flex-col rounded-md border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {p.name}
            </h2>
            <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
              {p.slug}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <StatusBadge status={currentStatus} />
            <MeshTelemetryPill
              healthStatus={p.healthStatus}
              lastHeartbeatAt={p.lastHeartbeatAt}
            />
            {currentStatus === "missing" || currentStatus === "corrupted" ? (
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
                    <span>[ START ]</span>
                  </span>
                ) : (
                  "[ START ]"
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
                    <span>[ STOP ]</span>
                  </span>
                ) : (
                  "[ STOP ]"
                )}
              </button>
            ) : null}
            <button
              type="button"
              onClick={openSettingsModal}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              aria-label={`Project settings for ${p.name}`}
              title="Project settings"
            >
              <Settings className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={openDeleteModal}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-red-50 hover:text-red-700 dark:text-zinc-400 dark:hover:bg-red-950/50 dark:hover:text-red-400"
              aria-label={`Delete project ${p.name}`}
              title="Delete project"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </header>

        <section className="mt-6" aria-labelledby={`connect-heading-${p.id}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2
                id={`connect-heading-${p.id}`}
                className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
              >
                How to connect
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
                Everything you need to reach Postgres and the REST API. Load
                secrets once; they are not stored in the project list.
              </p>
            </div>
            {!credentialsLoaded && canRevealCredentials ? (
              <button
                type="button"
                onClick={() => void revealKeys()}
                disabled={revealBusy}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                {revealBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden />
                )}
                Load connection secrets
              </button>
            ) : null}
          </div>

          {revealError ? (
            <p
              className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400"
              role="alert"
            >
              {revealError}
            </p>
          ) : null}

          <div className="mt-6 flex flex-col gap-6">
            <CopyableField
              label="Postgres connection string"
              value={
                credentialsLoaded ? (p.postgresConnectionString ?? null) : null
              }
              isSecret
              prominent
              emptyHint={connectSecretEmptyHint}
            />
            <CopyableField
              label="Anon key"
              value={credentialsLoaded ? (p.anonKey ?? null) : null}
              isSecret={false}
              visuallyTruncate
              prominent
              emptyHint={connectSecretEmptyHint}
            />
            <CopyableField
              label="Service URL"
              value={p.apiUrl || null}
              isSecret={false}
              visuallyTruncate
              prominent
            />
            <CopyableField
              label="Service role key"
              value={credentialsLoaded ? (p.serviceRoleKey ?? null) : null}
              isSecret
              prominent
              emptyHint={connectSecretEmptyHint}
            />
          </div>

          {!credentialsLoaded && !canRevealCredentials ? (
            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
              Secrets stay hidden until the stack is healthy. Use{" "}
              <strong className="font-medium">Repair</strong> if Docker is out of
              sync, or <strong className="font-medium">Delete</strong> to remove
              this project.
            </p>
          ) : null}
          {credentialsLoaded ? (
            <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
              Update the JWT signing secret or CORS from project settings when
              your auth setup changes.
            </p>
          ) : null}
        </section>

        <div className="mt-8">
          <CliSnippetBlock slug={p.slug} hash={p.hash} />
        </div>

        <div className="mt-6">
          <button
            type="button"
            onClick={() => setLogsOpen((open) => !open)}
            aria-expanded={logsOpen}
            className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            {logsOpen ? "Hide logs" : "Show logs"}
          </button>

          {logsOpen ? (
            <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
              <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Source
                </span>
                <div className="flex rounded-md border border-zinc-200 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-950">
                  <button
                    type="button"
                    onClick={() => setLogsService("api")}
                    className={`${logSourceBtn} ${logsService === "api" ? logSourceActive : logSourceIdle}`}
                  >
                    PostgREST
                  </button>
                  <button
                    type="button"
                    onClick={() => setLogsService("db")}
                    className={`${logSourceBtn} ${logsService === "db" ? logSourceActive : logSourceIdle}`}
                  >
                    Postgres
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void fetchLogs()}
                  disabled={logsLoading}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${logsLoading ? "animate-spin" : ""}`}
                    aria-hidden
                  />
                  Refresh
                </button>
              </div>
              {logsError ? (
                <p className="border-b border-zinc-200 px-3 py-2 text-sm text-red-600 dark:border-zinc-800 dark:text-red-400">
                  {logsError}
                </p>
              ) : null}
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all px-3 py-3 font-mono text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300">
                {logsLoading && !logsText ? "Loading…" : logsText}
              </pre>
            </div>
          ) : null}
        </div>

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

      {settingsOpen ? (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4 py-20 backdrop-blur-sm sm:py-8"
          role="presentation"
          onClick={closeSettingsModal}
        >
          <div
            className="relative w-full max-w-md rounded-md border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`settings-title-${p.id}`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeSettingsModal}
              disabled={settingsSaving}
              className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
              aria-label="Close"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>

            <div className="pr-10">
              <h2
                id={`settings-title-${p.id}`}
                className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
              >
                Project settings
              </h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Use the same signing secret as your auth provider (e.g. Clerk JWT
                template or NextAuth) so PostgREST can verify user tokens. After you
                save, use{" "}
                <strong className="font-medium text-zinc-800 dark:text-zinc-200">
                  Load connection secrets
                </strong>{" "}
                on the project card to refresh anon and service-role JWTs.
              </p>

              <form onSubmit={(e) => void saveJwtSettings(e)} className="mt-6">
                {lastSavedJwtSecret ? (
                  <div className="mb-6 space-y-2">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Signing key below is only kept until you close this dialog;
                      the server never sends it back.
                    </p>
                    <CopyableField
                      key={lastSavedJwtSecret}
                      label="Signing key you saved"
                      value={lastSavedJwtSecret}
                      isSecret
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setLastSavedJwtSecret(null);
                        setJwtSecretInput("");
                      }}
                      className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Replace secret
                    </button>
                  </div>
                ) : null}
                <label
                  htmlFor={`jwt-secret-${p.id}`}
                  className="block text-sm font-medium text-zinc-900 dark:text-zinc-100"
                >
                  {lastSavedJwtSecret
                    ? "Update JWT secret (optional)"
                    : "JWT secret / webhook secret"}
                </label>
                <input
                  id={`jwt-secret-${p.id}`}
                  type="password"
                  value={jwtSecretInput}
                  onChange={(e) => setJwtSecretInput(e.target.value)}
                  autoComplete="off"
                  placeholder="Paste signing key"
                  disabled={settingsSaving}
                  className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 font-mono text-sm outline-none transition-shadow focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-500/25"
                />

                {settingsError ? (
                  <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                    {settingsError}
                  </p>
                ) : null}
                {settingsSuccess ? (
                  <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">
                    Saved. PostgREST was restarted with the new secret.
                  </p>
                ) : null}

                <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
                  <button
                    type="button"
                    onClick={closeSettingsModal}
                    disabled={settingsSaving}
                    className="rounded-md px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={settingsSaving}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    {settingsSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : null}
                    {settingsSaving ? "Saving…" : "Save settings"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}

      {deleteOpen ? (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4 py-20 backdrop-blur-sm sm:py-8"
          role="presentation"
          onClick={closeDeleteModal}
        >
          <div
            className="relative w-full max-w-md rounded-md border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`delete-title-${p.id}`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeDeleteModal}
              disabled={isDeleting}
              className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
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
                  className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none ring-zinc-200 transition-shadow focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:ring-zinc-800 dark:focus:border-zinc-500 dark:focus:ring-zinc-500/25"
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
                    className="rounded-md px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={deleteConfirm !== p.name || isDeleting}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-700 dark:hover:bg-red-600"
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

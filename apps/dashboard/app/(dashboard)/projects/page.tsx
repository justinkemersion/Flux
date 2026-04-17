"use client";

import {
  AlertTriangle,
  Check,
  Clipboard,
  Eye,
  EyeOff,
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
  createdAt: string;
  /** Loaded only after "Reveal keys" — not returned by list API. */
  anonKey?: string | null;
  serviceRoleKey?: string | null;
  postgresConnectionString?: string | null;
};

type DisplayStatus = ServerStatus | "transitioning";

const HOBBY_LIMIT_API_MESSAGE =
  "Project limit reached. Please upgrade to Pro.";
const PRO_LIMIT_API_MESSAGE =
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

function CopyableField({
  label,
  value,
  isSecret,
  visuallyTruncate = false,
}: {
  label: string;
  value: string | null;
  isSecret: boolean;
  /** Single-line ellipsis for long non-secret values (e.g. anon JWT). */
  visuallyTruncate?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const raw = value ?? "";
  const unavailable = raw.length === 0;
  const masked = isSecret && !revealed && !unavailable;
  const displayText = unavailable
    ? "Unavailable"
    : masked
      ? "••••••••"
      : raw;

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

  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-zinc-200/80 bg-zinc-50/80 px-2 py-1.5 dark:border-zinc-700/80 dark:bg-zinc-900/50">
        <span
          className={`min-w-0 flex-1 font-mono text-xs leading-relaxed text-zinc-800 dark:text-zinc-200 ${
            visuallyTruncate && !masked
              ? "truncate"
              : unavailable
                ? "text-zinc-400 dark:text-zinc-500"
                : "break-all"
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
};

function ProjectCard({
  project: p,
  onDelete,
  onSettingsSaved,
  onCredentialsRevealed,
}: ProjectCardProps) {
  const [isBusy, setIsBusy] = useState(false);
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

  const credentialsLoaded =
    (p.anonKey?.length ?? 0) > 0 &&
    (p.serviceRoleKey?.length ?? 0) > 0 &&
    (p.postgresConnectionString?.length ?? 0) > 0;

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

  async function revealKeys(): Promise<void> {
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
          <div className="rounded-lg border border-zinc-200/70 bg-zinc-50/40 p-3 dark:border-zinc-800 dark:bg-zinc-900/30">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Connection details
              </h3>
              {!credentialsLoaded ? (
                <button
                  type="button"
                  onClick={() => void revealKeys()}
                  disabled={revealBusy}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 shadow-sm transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                >
                  {revealBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Eye className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Reveal keys
                </button>
              ) : null}
            </div>
            {revealError ? (
              <p
                className="mb-3 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-400"
                role="alert"
              >
                {revealError}
              </p>
            ) : null}
            <div className="flex flex-col gap-3">
              <CopyableField
                label="API URL"
                value={p.apiUrl}
                isSecret={false}
                visuallyTruncate
              />
              {!credentialsLoaded ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  API keys and Postgres connection string are not loaded. Use{" "}
                  <strong className="font-medium text-zinc-700 dark:text-zinc-300">
                    Reveal keys
                  </strong>{" "}
                  to fetch them from the server.
                </p>
              ) : (
                <>
                  <CopyableField
                    label="Anon key"
                    value={p.anonKey ?? null}
                    isSecret={false}
                    visuallyTruncate
                  />
                  <CopyableField
                    label="Service role key"
                    value={p.serviceRoleKey ?? null}
                    isSecret
                  />
                  <CopyableField
                    label="Postgres connection string"
                    value={p.postgresConnectionString ?? null}
                    isSecret
                  />
                </>
              )}
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
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={openSettingsModal}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              aria-label={`Project settings for ${p.name}`}
              title="Project settings"
            >
              <Settings className="h-5 w-5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={openDeleteModal}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-red-50 hover:text-red-700 dark:text-zinc-400 dark:hover:bg-red-950/50 dark:hover:text-red-400"
              aria-label={`Delete project ${p.name}`}
              title="Delete project"
            >
              <Trash2 className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </footer>
      </article>

      {settingsOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={closeSettingsModal}
        >
          <div
            className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-zinc-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`settings-title-${p.id}`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeSettingsModal}
              disabled={settingsSaving}
              className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
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
                  Reveal keys
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
                  className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 font-mono text-sm outline-none transition-shadow focus:border-blue-500 focus:ring-2 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-950"
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
                    className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={settingsSaving}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
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
  const [createLimitBanner, setCreateLimitBanner] = useState<
    "hobby" | "pro" | null
  >(null);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [userPlan, setUserPlan] = useState<"hobby" | "pro" | null>(null);

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
        <div className="flex shrink-0 items-center gap-2">
          {userPlan === "hobby" ? (
            <button
              type="button"
              onClick={() => void startProCheckout()}
              disabled={upgradeLoading}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-amber-300/90 bg-gradient-to-r from-red-600 to-amber-600 px-4 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-700/80"
            >
              {upgradeLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {upgradeLoading ? "Redirecting…" : "Upgrade to Pro"}
            </button>
          ) : userPlan === "pro" ? (
            <span
              className="inline-flex h-10 items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
              title="Your account is on the Pro plan"
            >
              Pro
            </span>
          ) : null}
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-900 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
            aria-label="Create project"
          >
            <Plus className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </header>

      {billingError && !createOpen ? (
        <p
          className="mb-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
          role="alert"
        >
          {billingError}
        </p>
      ) : null}

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
              onSettingsSaved={handleSettingsSavedClearCredentials}
              onCredentialsRevealed={handleCredentialsRevealed}
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

              {createLimitBanner === "hobby" ? (
                <div
                  className="mt-5 flex flex-col gap-3 rounded-xl border border-amber-300/80 bg-gradient-to-br from-red-50 to-amber-50 p-4 dark:border-amber-700/60 dark:from-red-950/50 dark:to-amber-950/40"
                  role="alert"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-200/90 dark:bg-amber-900/80">
                      <AlertTriangle
                        className="h-5 w-5 text-amber-800 dark:text-amber-200"
                        aria-hidden
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-red-900 dark:text-red-200">
                        Free tier limit reached (2/2 projects).
                      </p>
                      <p className="mt-1 text-sm text-amber-900/90 dark:text-amber-100/90">
                        Delete a project or upgrade to create more.
                      </p>
                      {billingError ? (
                        <p className="mt-2 text-sm text-red-700 dark:text-red-400">
                          {billingError}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void startProCheckout()}
                        disabled={upgradeLoading}
                        className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-red-600 to-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
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
                  className="mt-5 flex items-start gap-3 rounded-xl border border-amber-300/80 bg-amber-50 p-4 dark:border-amber-700/60 dark:bg-amber-950/50"
                  role="alert"
                >
                  <AlertTriangle
                    className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300"
                    aria-hidden
                  />
                  <p className="text-sm text-amber-950 dark:text-amber-100">
                    You&apos;ve reached the project limit for your Pro plan (10
                    projects).
                  </p>
                </div>
              ) : null}

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

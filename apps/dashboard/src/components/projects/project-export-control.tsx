"use client";

import {
  backupTrustTierLabelForKind,
  BACKUP_TRUST_REMEDIATION_CLI,
  classifyNewestBackup,
  type BackupKind,
  type BackupTrustInput,
  type BackupTrustTier,
} from "@flux/core/backup-trust";
import { ChevronDown, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  hash: string;
  /** Used when no backup rows yet (correct pooled vs dedicated copy). */
  mode: "v1_dedicated" | "v2_shared";
};

type BackupItem = {
  id: string;
  kind?: BackupKind;
  status: string;
  sizeBytes?: number | null;
  createdAt?: string | null;
  offsiteStatus?: string | null;
  artifactValidationStatus?: string | null;
  restoreVerificationStatus?: string | null;
};

function backupTrustBadgeClass(tier: BackupTrustTier): string {
  switch (tier) {
    case "restorable":
      return "border-emerald-700/70 bg-emerald-950/50 text-emerald-100";
    case "restore_failed":
      return "border-rose-700/70 bg-rose-950/40 text-rose-100";
    case "artifact_pending":
      return "border-zinc-400/50 bg-zinc-100/90 text-zinc-700 dark:border-zinc-600/60 dark:bg-zinc-800/60 dark:text-zinc-200";
    case "pipeline_incomplete":
    case "latest_not_complete":
      return "border-amber-700/60 bg-amber-950/30 text-amber-100";
    default:
      return "border-zinc-400/45 bg-zinc-100/80 text-zinc-700 dark:border-zinc-600/50 dark:bg-zinc-800/50 dark:text-zinc-200";
  }
}

function backupTrustEmoji(tier: BackupTrustTier): string {
  if (tier === "restorable") return "✓";
  if (tier === "restore_failed") return "✗";
  if (tier === "artifact_pending") return "⋯";
  if (tier === "pipeline_incomplete" || tier === "latest_not_complete") return "⚠";
  return "○";
}

/** CLI line is only helpful when the backup needs action—not while validation is still catching up. */
function backupTierShowsFluxRemediationCli(tier: BackupTrustTier): boolean {
  switch (tier) {
    case "not_restore_verified":
    case "restore_failed":
    case "pipeline_incomplete":
    case "latest_not_complete":
    case "no_backups":
      return true;
    default:
      return false;
  }
}

const sqlDumpCheckboxClass =
  "h-4 w-4 shrink-0 rounded border border-zinc-300 bg-white text-zinc-900 focus:ring-2 focus:ring-zinc-400/30 focus:ring-offset-0 dark:border-zinc-600 dark:bg-zinc-900 dark:focus:ring-zinc-500/25";

const primaryModalActionClass =
  "inline-flex min-h-[2.75rem] w-full items-center justify-center gap-2 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200";

/**
 * Project export controls for SQL dump streaming.
 */
export function ProjectExportControl({ hash, mode }: Props) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [schemaOnly, setSchemaOnly] = useState(false);
  const [dataOnly, setDataOnly] = useState(false);
  const [clean, setClean] = useState(false);
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);

  const downloadHref = useMemo(() => {
    const params = new URLSearchParams();
    if (schemaOnly) params.set("schemaOnly", "1");
    if (dataOnly) params.set("dataOnly", "1");
    if (clean) params.set("clean", "1");
    const q = params.toString();
    const base = `/api/cli/v1/projects/${encodeURIComponent(hash)}/dump`;
    return q.length > 0 ? `${base}?${q}` : base;
  }, [clean, dataOnly, hash, schemaOnly]);

  const backupTrust = useMemo(
    () => classifyNewestBackup(backups as BackupTrustInput[]),
    [backups],
  );

  const newestBackupKind =
    backups[0]?.kind ?? (mode === "v2_shared" ? "tenant_export" : "project_db");

  const latestBackup = backups[0];
  const verifyLatestDisabledReason = useMemo((): string | null => {
    if (!latestBackup) return "No backups yet.";
    if (latestBackup.status !== "complete") return "Latest backup is not complete.";
    if (latestBackup.artifactValidationStatus === "artifact_invalid") {
      return "Latest artifact is invalid on the server — create a new backup.";
    }
    if (latestBackup.restoreVerificationStatus === "restore_verified") {
      return "Latest backup is already restore-verified.";
    }
    return null;
  }, [latestBackup]);

  function onSchemaToggle(): void {
    setSchemaOnly((prev) => {
      const next = !prev;
      if (next) setDataOnly(false);
      return next;
    });
  }

  function onDataToggle(): void {
    setDataOnly((prev) => {
      const next = !prev;
      if (next) setSchemaOnly(false);
      return next;
    });
  }

  function downloadDump(): void {
    window.location.assign(downloadHref);
  }

  async function loadBackups(): Promise<void> {
    setBackupsLoading(true);
    setBackupError(null);
    try {
      const res = await fetch(`/api/cli/v1/projects/${encodeURIComponent(hash)}/backups`);
      const body = (await res.json()) as { backups?: BackupItem[]; error?: string };
      if (!res.ok) {
        throw new Error(body.error || `Request failed (${String(res.status)})`);
      }
      setBackups(Array.isArray(body.backups) ? body.backups : []);
    } catch (err: unknown) {
      setBackupError(err instanceof Error ? err.message : String(err));
    } finally {
      setBackupsLoading(false);
    }
  }

  async function createBackupNow(): Promise<void> {
    setBackupBusy(true);
    setBackupError(null);
    try {
      const res = await fetch(`/api/cli/v1/projects/${encodeURIComponent(hash)}/backups`, {
        method: "POST",
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error || `Request failed (${String(res.status)})`);
      }
      await loadBackups();
    } catch (err: unknown) {
      setBackupError(err instanceof Error ? err.message : String(err));
    } finally {
      setBackupBusy(false);
    }
  }

  function downloadLatestBackup(): void {
    const latest = backups[0];
    if (!latest) return;
    window.location.assign(
      `/api/cli/v1/projects/${encodeURIComponent(hash)}/backups/${encodeURIComponent(latest.id)}/download`,
    );
  }

  async function verifyLatestBackupRestore(): Promise<void> {
    const latest = backups[0];
    if (!latest || verifyLatestDisabledReason) return;
    setVerifyBusy(true);
    setBackupError(null);
    try {
      const res = await fetch(
        `/api/cli/v1/projects/${encodeURIComponent(hash)}/backups/${encodeURIComponent(latest.id)}/verify`,
        { method: "POST" },
      );
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (res.status === 409) {
        throw new Error(body.error || "Another backup verify or create is already running.");
      }
      if (!res.ok) {
        throw new Error(body.error || `Request failed (${String(res.status)})`);
      }
      await loadBackups();
    } catch (err: unknown) {
      setBackupError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifyBusy(false);
    }
  }

  useEffect(() => {
    if (!toolsOpen) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setToolsOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toolsOpen]);

  useEffect(() => {
    if (!toolsOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [toolsOpen]);

  useEffect(() => {
    if (!toolsOpen) return;
    void loadBackups();
  }, [hash, toolsOpen]);

  return (
    <>
      <section
        className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950/40"
        aria-label="Project database tools"
      >
        <div className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Database
        </div>
        <button
          type="button"
          onClick={() => setToolsOpen(true)}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          Open database tools
        </button>
      </section>

      {toolsOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[240] flex items-start justify-center overflow-y-auto bg-zinc-950/70 p-4 pt-3 backdrop-blur-md sm:pt-4"
              role="presentation"
              onClick={() => setToolsOpen(false)}
            >
              <div
                className="relative w-full max-w-2xl rounded-md border border-zinc-200/70 bg-white p-6 shadow-2xl dark:border-zinc-800/80 dark:bg-zinc-900"
                role="dialog"
                aria-modal="true"
                aria-labelledby="database-tools-title"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => setToolsOpen(false)}
                  className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" aria-hidden />
                </button>

                <div className="pr-10">
                  <h2
                    id="database-tools-title"
                    className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
                  >
                    Database Tools
                  </h2>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    Manage project backups, verify restore health, and export SQL
                    snapshots.
                  </p>
                </div>

                <section
                  className="mt-6 rounded-xl border border-zinc-200/70 bg-zinc-50/80 p-4 dark:border-zinc-800/60 dark:bg-zinc-950/40"
                  aria-labelledby="database-tools-backups-heading"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <h3
                        id="database-tools-backups-heading"
                        className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
                      >
                        Backups
                      </h3>
                      <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
                        Create, download, and verify project snapshots.
                      </p>
                      {newestBackupKind === "tenant_export" ? (
                        <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
                          Portable tenant export of your PostgREST schema (
                          <code className="font-mono">t_&lt;shortId&gt;_api</code>
                          ). Restoring this archive into any Postgres recreates schema and data;
                          it does not include shared cluster system tables or full-cluster DR.
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                          Full-database snapshot for dedicated (v1) stacks.
                        </p>
                      )}
                    </div>
                    <span
                      className={`inline-flex shrink-0 self-start rounded-md border px-2.5 py-1 text-xs font-medium leading-snug ${backupTrustBadgeClass(backupTrust.tier)}`}
                    >
                      <span aria-hidden className="mr-1 select-none">
                        {backupTrustEmoji(backupTrust.tier)}
                      </span>
                      {backupTrustTierLabelForKind(newestBackupKind, backupTrust.tier)}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => void createBackupNow()}
                      disabled={backupBusy}
                      aria-busy={backupBusy}
                      className={primaryModalActionClass}
                    >
                      {backupBusy ? (
                        <Loader2
                          className="h-4 w-4 shrink-0 animate-spin"
                          aria-hidden
                        />
                      ) : null}
                      {backupBusy ? "Creating backup…" : "Create backup now"}
                    </button>
                    <button
                      type="button"
                      onClick={downloadLatestBackup}
                      disabled={backups.length === 0}
                      className={primaryModalActionClass}
                    >
                      Download latest backup
                    </button>
                    <button
                      type="button"
                      onClick={() => void verifyLatestBackupRestore()}
                      disabled={
                        backupsLoading ||
                        verifyBusy ||
                        backupBusy ||
                        verifyLatestDisabledReason !== null
                      }
                      title={verifyLatestDisabledReason ?? undefined}
                      aria-busy={verifyBusy}
                      className={primaryModalActionClass}
                    >
                      {verifyBusy ? (
                        <Loader2
                          className="h-4 w-4 shrink-0 animate-spin"
                          aria-hidden
                        />
                      ) : null}
                      {verifyBusy
                        ? "Verifying latest backup"
                        : "Verify latest backup"}
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                    <span>
                      {backupsLoading
                        ? "Loading backups…"
                        : `Stored backups: ${String(backups.length)}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => void loadBackups()}
                      disabled={backupsLoading || backupBusy || verifyBusy}
                      className="text-sm font-medium text-zinc-700 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-300 dark:hover:text-zinc-100"
                    >
                      Refresh status
                    </button>
                  </div>

                  {!backupsLoading ? (
                    <div className="mt-4 space-y-4">
                      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        {backupTrust.detail}
                      </p>
                      {backups[0] ? (
                        <dl className="grid gap-1 text-xs text-zinc-500 dark:text-zinc-400 sm:grid-cols-[8rem_1fr] sm:gap-x-3">
                          <dt className="font-medium text-zinc-600 dark:text-zinc-500">
                            Newest backup
                          </dt>
                          <dd className="font-mono text-zinc-600 dark:text-zinc-400">
                            {backups[0].createdAt ?? "—"}
                          </dd>
                          <dt className="font-medium text-zinc-600 dark:text-zinc-500">
                            Offsite copy
                          </dt>
                          <dd>{backups[0].offsiteStatus ?? "—"}</dd>
                        </dl>
                      ) : null}
                      {backupTierShowsFluxRemediationCli(backupTrust.tier) ? (
                        <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                          <span className="font-medium text-zinc-700 dark:text-zinc-300">
                            CLI:
                          </span>{" "}
                          <code className="break-all font-mono text-zinc-600 dark:text-zinc-400">
                            {BACKUP_TRUST_REMEDIATION_CLI}
                          </code>
                        </p>
                      ) : null}
                      {backups.length > 1 ? (
                        <details className="group rounded-lg border border-zinc-200/60 bg-white/60 dark:border-zinc-800/60 dark:bg-zinc-950/30">
                          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 [&::-webkit-details-marker]:hidden">
                            <ChevronDown
                              className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
                              aria-hidden
                            />
                            Older backups ({String(backups.length - 1)})
                          </summary>
                          <ul className="max-h-40 overflow-y-auto border-t border-zinc-200/60 px-3 py-2 text-xs dark:border-zinc-800/60">
                            {backups.slice(1).map((b) => {
                              const rowTrust = classifyNewestBackup([b]);
                              return (
                                <li
                                  key={b.id}
                                  className="border-b border-zinc-200/80 py-2.5 text-zinc-600 last:border-b-0 dark:border-zinc-800/80 dark:text-zinc-400"
                                >
                                  <div className="break-all font-mono text-zinc-700 dark:text-zinc-400">
                                    {b.id}
                                  </div>
                                  <div className="mt-1 flex justify-between gap-2">
                                    <span>{b.status}</span>
                                    <span className="shrink-0 text-zinc-500 dark:text-zinc-500">
                                      {backupTrustTierLabelForKind(b.kind ?? "project_db", rowTrust.tier)}
                                    </span>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </details>
                      ) : null}
                    </div>
                  ) : null}
                  {backupError ? (
                    <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
                      {backupError}
                    </p>
                  ) : null}
                </section>

                <section className="mt-6" aria-labelledby="database-tools-export-heading">
                  <h3
                    id="database-tools-export-heading"
                    className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
                  >
                    Export SQL
                  </h3>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    Configure dump options, then download a snapshot.
                  </p>

                  <div className="mt-4 space-y-2">
                    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-zinc-200/70 px-3 py-2.5 transition-colors hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40">
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          Schema only
                        </span>
                        <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-500">
                          DDL without row data (mutually exclusive with data only).
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={schemaOnly}
                        onChange={onSchemaToggle}
                        className={sqlDumpCheckboxClass}
                        aria-label="Schema only"
                      />
                    </label>
                    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-zinc-200/70 px-3 py-2.5 transition-colors hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40">
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          Data only
                        </span>
                        <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-500">
                          Row data without schema (mutually exclusive with schema only).
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={dataOnly}
                        onChange={onDataToggle}
                        className={sqlDumpCheckboxClass}
                        aria-label="Data only"
                      />
                    </label>
                    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-zinc-200/70 px-3 py-2.5 transition-colors hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40">
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          Include DROP commands
                        </span>
                        <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-500">
                          Emit DROP statements before CREATE for a clean replay.
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={clean}
                        onChange={(e) => setClean(e.target.checked)}
                        className={sqlDumpCheckboxClass}
                        aria-label="Include DROP commands"
                      />
                    </label>
                  </div>

                  <div className="mt-4 max-w-md">
                    <button
                      type="button"
                      onClick={downloadDump}
                      className={primaryModalActionClass}
                    >
                      Download SQL dump
                    </button>
                  </div>
                </section>

                <div className="mt-6 border-t border-zinc-200/70 pt-5 dark:border-zinc-800/80">
                  <p className="text-xs font-medium text-zinc-500 dark:text-zinc-500">
                    Coming soon
                  </p>
                  <ul className="mt-2 space-y-1.5 text-xs text-zinc-500 dark:text-zinc-500">
                    <li>Import SQL dump</li>
                    <li>Seed runner</li>
                    <li>Table browser</li>
                  </ul>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

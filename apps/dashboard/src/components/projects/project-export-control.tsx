"use client";

import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  hash: string;
};

type BackupItem = {
  id: string;
  status: string;
  sizeBytes?: number | null;
  createdAt?: string | null;
  offsiteStatus?: string | null;
  artifactValidationStatus?: string | null;
  restoreVerificationStatus?: string | null;
};

/**
 * Project export controls for SQL dump streaming.
 */
export function ProjectExportControl({ hash }: Props) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [schemaOnly, setSchemaOnly] = useState(false);
  const [dataOnly, setDataOnly] = useState(false);
  const [clean, setClean] = useState(false);
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
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
              className="fixed inset-0 z-[240] flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-3 backdrop-blur-sm sm:pt-4"
              role="presentation"
              onClick={() => setToolsOpen(false)}
            >
              <div
                className="relative w-full max-w-2xl rounded-md border border-zinc-800 bg-zinc-950 p-4 font-mono sm:p-5"
                role="dialog"
                aria-modal="true"
                aria-labelledby="database-tools-title"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => setToolsOpen(false)}
                  className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" aria-hidden />
                </button>

                <h3
                  id="database-tools-title"
                  className="pr-8 text-sm font-semibold text-zinc-200"
                >
                  Database Tools
                </h3>
                <p className="mt-1 text-xs text-zinc-500">
                  Export is available now. Additional DB tools can live here as they
                  ship.
                </p>

                <section className="mt-4 border border-zinc-800 bg-zinc-950 p-3">
                  <p className="mb-3 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                    Backups (v1 dedicated)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void createBackupNow()}
                      disabled={backupBusy}
                      className="rounded-md border border-zinc-700 bg-black px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {backupBusy ? "Creating backup..." : "Create backup now"}
                    </button>
                    <button
                      type="button"
                      onClick={downloadLatestBackup}
                      disabled={backups.length === 0}
                      className="rounded-md border border-zinc-700 bg-black px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Download latest backup
                    </button>
                  </div>
                  <div className="mt-3 text-xs text-zinc-400">
                    {backupsLoading ? "Loading backups..." : `Backups: ${String(backups.length)}`}
                  </div>
                  {backups[0] ? (
                    <div className="mt-1 text-xs text-zinc-400">
                      Last backup: {backups[0].createdAt ?? "-"} | offsite: {backups[0].offsiteStatus ?? "-"} | artifact validation: {backups[0].artifactValidationStatus ?? "-"} | restore verify: {backups[0].restoreVerificationStatus ?? "-"}
                    </div>
                  ) : null}
                  {backupError ? (
                    <p className="mt-2 text-xs text-rose-400">{backupError}</p>
                  ) : null}
                </section>

                <section className="mt-4 border border-zinc-800 bg-zinc-950 p-3">
                  <p className="mb-3 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                    Export SQL Dump
                  </p>
                  <div className="grid grid-cols-1 border border-zinc-800 text-[11px] text-zinc-300 sm:grid-cols-[1fr_auto]">
                    <label className="contents cursor-pointer">
                      <span className="border-b border-zinc-800 bg-black px-3 py-2 sm:border-r">
                        Schema only
                      </span>
                      <span className="border-b border-zinc-800 bg-zinc-950 px-3 py-2 text-right">
                        <input
                          type="checkbox"
                          checked={schemaOnly}
                          onChange={onSchemaToggle}
                          className="h-3.5 w-3.5 rounded-none border-zinc-600 bg-black text-zinc-300 focus:ring-0 focus:ring-offset-0"
                        />
                      </span>
                    </label>
                    <label className="contents cursor-pointer">
                      <span className="border-b border-zinc-800 bg-black px-3 py-2 sm:border-r">
                        Data only
                      </span>
                      <span className="border-b border-zinc-800 bg-zinc-950 px-3 py-2 text-right">
                        <input
                          type="checkbox"
                          checked={dataOnly}
                          onChange={onDataToggle}
                          className="h-3.5 w-3.5 rounded-none border-zinc-600 bg-black text-zinc-300 focus:ring-0 focus:ring-offset-0"
                        />
                      </span>
                    </label>
                    <label className="contents cursor-pointer">
                      <span className="bg-black px-3 py-2 sm:border-r">
                        Include DROP commands
                      </span>
                      <span className="bg-zinc-950 px-3 py-2 text-right">
                        <input
                          type="checkbox"
                          checked={clean}
                          onChange={(e) => setClean(e.target.checked)}
                          className="h-3.5 w-3.5 rounded-none border-zinc-600 bg-black text-zinc-300 focus:ring-0 focus:ring-offset-0"
                        />
                      </span>
                    </label>
                  </div>
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={downloadDump}
                      className="rounded-md border border-zinc-700 bg-black px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white"
                    >
                      Download SQL dump
                    </button>
                  </div>
                </section>

                <section className="mt-4 border border-zinc-800 bg-zinc-950 p-3">
                  <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                    Coming Soon
                  </p>
                  <ul className="space-y-1 text-[11px] text-zinc-400">
                    <li>- Import SQL dump</li>
                    <li>- Seed runner</li>
                    <li>- Table browser</li>
                  </ul>
                </section>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

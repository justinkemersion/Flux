"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { DestructiveBackupGateBanner } from "@/src/components/projects/destructive-backup-gate-banner";
import { ProjectModalShell } from "@/src/components/projects/modal-shell";
import type { ProjectRow } from "@/src/components/projects/project-types";
import type { BackupTrustClassification } from "@flux/core/backup-trust";

type Props = {
  open: boolean;
  mounted: boolean;
  project: ProjectRow;
  backupTrust: BackupTrustClassification;
  backupTrustLoading: boolean;
  backupTrustError: string | null;
  onRefreshBackupTrust: () => void;
  resetConfirm: string;
  onResetConfirmChange: (value: string) => void;
  resetBusy: boolean;
  resetError: string | null;
  destructiveBlocked: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
};

export function ProjectCardFactoryResetModal(props: Props): React.ReactElement | null {
  const {
    open,
    mounted,
    project: p,
    backupTrust,
    backupTrustLoading,
    backupTrustError,
    onRefreshBackupTrust,
    resetConfirm,
    onResetConfirmChange,
    resetBusy,
    resetError,
    destructiveBlocked,
    onClose,
    onSubmit,
  } = props;

  const expectedConfirm = `RESET ${p.name}`;

  return (
    <ProjectModalShell
      open={open}
      mounted={mounted}
      onClose={onClose}
      labelledBy={`reset-title-${p.id}`}
      tier="destructive"
      accentBorder
      closeDisabled={resetBusy}
    >
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
              id={`reset-title-${p.id}`}
              className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
            >
              Factory reset project
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              This destroys all database data for{" "}
              <strong className="text-zinc-900 dark:text-zinc-100">{p.name}</strong> by
              removing containers and volumes, then reprovisions a fresh empty stack.
            </p>
          </div>
        </div>

        <DestructiveBackupGateBanner
          slug={p.slug}
          trust={backupTrust}
          loading={backupTrustLoading}
          fetchError={backupTrustError}
          onRefresh={onRefreshBackupTrust}
        />

        <form onSubmit={onSubmit}>
          <label
            htmlFor={`reset-confirm-${p.id}`}
            className="block text-sm font-medium text-zinc-900 dark:text-zinc-100"
          >
            Type{" "}
            <span className="font-geist-sans font-semibold">{expectedConfirm}</span> to
            confirm
          </label>
          <input
            id={`reset-confirm-${p.id}`}
            type="text"
            value={resetConfirm}
            onChange={(e) => onResetConfirmChange(e.target.value)}
            className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none ring-zinc-200 transition-shadow focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:ring-zinc-800 dark:focus:border-zinc-500 dark:focus:ring-zinc-500/25"
            placeholder={expectedConfirm}
            autoComplete="off"
            disabled={resetBusy}
          />

          {resetError ? (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{resetError}</p>
          ) : null}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={resetBusy}
              className="rounded-md px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                resetConfirm !== expectedConfirm || resetBusy || destructiveBlocked
              }
              className="inline-flex items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-700 dark:hover:bg-red-600"
            >
              {resetBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <AlertTriangle className="h-4 w-4" aria-hidden />
              )}
              {resetBusy ? "Resetting…" : "Factory reset"}
            </button>
          </div>
        </form>
      </div>
    </ProjectModalShell>
  );
}

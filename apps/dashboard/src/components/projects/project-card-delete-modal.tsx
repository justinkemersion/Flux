"use client";

import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { DestructiveBackupGateBanner } from "@/src/components/projects/destructive-backup-gate-banner";
import { ProjectModalShell } from "@/src/components/projects/modal-shell";
import type { ProjectRow } from "@/src/components/projects/project-types";
import type { BackupTrustClassification } from "@flux/core/backup-trust";

type Props = {
  open: boolean;
  mounted: boolean;
  project: ProjectRow;
  isV2Shared: boolean;
  backupTrust: BackupTrustClassification;
  backupTrustLoading: boolean;
  backupTrustError: string | null;
  onRefreshBackupTrust: () => void;
  deleteConfirm: string;
  onDeleteConfirmChange: (value: string) => void;
  isDeleting: boolean;
  deleteError: string | null;
  destructiveBlocked: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
};

export function ProjectCardDeleteModal(props: Props): React.ReactElement | null {
  const {
    open,
    mounted,
    project: p,
    isV2Shared,
    backupTrust,
    backupTrustLoading,
    backupTrustError,
    onRefreshBackupTrust,
    deleteConfirm,
    onDeleteConfirmChange,
    isDeleting,
    deleteError,
    destructiveBlocked,
    onClose,
    onSubmit,
  } = props;

  return (
    <ProjectModalShell
      open={open}
      mounted={mounted}
      onClose={onClose}
      labelledBy={`delete-title-${p.id}`}
      tier="destructive"
      closeDisabled={isDeleting}
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
              id={`delete-title-${p.id}`}
              className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
            >
              Delete project
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {isV2Shared
                ? "This permanently removes the shared-cluster tenant schema and role for"
                : "This permanently destroys all containers and database volumes for"}{" "}
              <strong className="text-zinc-900 dark:text-zinc-100">{p.name}</strong>. This
              action cannot be undone.
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
            htmlFor={`delete-confirm-${p.id}`}
            className="block text-sm font-medium text-zinc-900 dark:text-zinc-100"
          >
            Type <span className="font-geist-sans font-semibold">{p.name}</span> to confirm
          </label>
          <input
            id={`delete-confirm-${p.id}`}
            type="text"
            value={deleteConfirm}
            onChange={(e) => onDeleteConfirmChange(e.target.value)}
            className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none ring-zinc-200 transition-shadow focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:ring-zinc-800 dark:focus:border-zinc-500 dark:focus:ring-zinc-500/25"
            placeholder={p.name}
            autoComplete="off"
            disabled={isDeleting}
          />

          {deleteError ? (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{deleteError}</p>
          ) : null}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isDeleting}
              className="rounded-md px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={deleteConfirm !== p.name || isDeleting || destructiveBlocked}
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
    </ProjectModalShell>
  );
}

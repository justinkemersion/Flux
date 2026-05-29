"use client";

import {
  BACKUP_TRUST_REMEDIATION_CLI,
  type BackupTrustClassification,
} from "@flux/core/backup-trust";
import { scrollToProjectDatabaseTools } from "@/src/lib/project-backup-trust-client";

type Props = {
  slug: string;
  trust: BackupTrustClassification;
  loading: boolean;
  fetchError: string | null;
  onRefresh: () => void;
};

/**
 * Shown inside delete / factory-reset modals when the server gate would return 412.
 */
export function DestructiveBackupGateBanner({
  slug,
  trust,
  loading,
  fetchError,
  onRefresh,
}: Props): React.ReactElement | null {
  if (loading) {
    return (
      <p
        className="mb-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-300"
        role="status"
      >
        Checking whether the latest backup is restore-verified…
      </p>
    );
  }

  if (fetchError) {
    return (
      <p
        className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
        role="alert"
      >
        Could not load backup status: {fetchError}.{" "}
        <button
          type="button"
          onClick={() => onRefresh()}
          className="font-medium underline underline-offset-2"
        >
          Retry
        </button>
      </p>
    );
  }

  if (trust.allowsDestructiveWithoutOverride) return null;

  return (
    <div
      className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
      role="alert"
    >
      <p>{trust.detail}</p>
      <p className="mt-2">
        Create and verify a backup before deleting or resetting. In{" "}
        <strong className="font-medium">Database</strong> tools: backup → verify latest.
        CLI:{" "}
        <code className="rounded bg-amber-100/80 px-1 py-0.5 font-mono text-xs dark:bg-amber-900/50">
          {BACKUP_TRUST_REMEDIATION_CLI}
        </code>
      </p>
      <button
        type="button"
        onClick={() => scrollToProjectDatabaseTools(slug)}
        className="mt-2 text-sm font-medium text-amber-900 underline underline-offset-2 dark:text-amber-200"
      >
        Jump to Database tools
      </button>
    </div>
  );
}

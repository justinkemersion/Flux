"use client";

import {
  backupKindExplanation,
  backupTrustTierLabelForKind,
  formatBackupTrustSummary,
  type BackupKind,
  type BackupTrustClassification,
  type BackupTrustTier,
} from "@flux/core/backup-trust";
import { Check, Circle, Ellipsis, Loader2, X } from "lucide-react";
import type { ReactElement } from "react";
import {
  scrollToProjectDatabaseTools,
  type ProjectBackupRow,
} from "@/src/lib/project-backup-trust-client";

type Props = {
  slug: string;
  mode: "v1_dedicated" | "v2_shared";
  backups: ProjectBackupRow[];
  trust: BackupTrustClassification;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  /** Compact one-line variant for fleet cards. */
  variant?: "card" | "inline";
};

function tierBadgeClass(tier: BackupTrustTier): string {
  switch (tier) {
    case "restorable":
      return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200";
    case "restore_failed":
      return "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200";
    case "artifact_pending":
      return "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-200";
    case "pipeline_incomplete":
    case "latest_not_complete":
      return "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100";
    default:
      return "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-200";
  }
}

function TierIcon({ tier }: { tier: BackupTrustTier }): ReactElement {
  const className = "h-3 w-3 shrink-0";
  switch (tier) {
    case "restorable":
      return <Check className={className} aria-hidden />;
    case "restore_failed":
      return <X className={className} aria-hidden />;
    case "artifact_pending":
      return <Ellipsis className={className} aria-hidden />;
    default:
      return <Circle className={className} aria-hidden />;
  }
}

function formatLatestBackupAt(iso: string | null | undefined): string {
  if (!iso?.trim()) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ProjectBackupStatusCard({
  slug,
  mode,
  backups,
  trust,
  loading,
  error,
  onRefresh,
  variant = "card",
}: Props): ReactElement {
  const newestKind: BackupKind =
    backups[0]?.kind ?? (mode === "v2_shared" ? "tenant_export" : "project_db");
  const summary = formatBackupTrustSummary({
    classification: trust,
    kind: newestKind,
    latestBackupCreatedAt: backups[0]?.createdAt ?? null,
  });
  const latestDisplay =
    summary.latestBackup === "None yet" || summary.latestBackup === "—"
      ? summary.latestBackup
      : formatLatestBackupAt(summary.latestBackup);

  if (variant === "inline") {
    if (loading) {
      return (
        <span
          className="inline-flex items-center gap-1.5 text-xs text-zinc-500"
          title="Checking backup status…"
        >
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          Backup…
        </span>
      );
    }
    if (error) {
      return (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-amber-700/50 bg-amber-950/30 px-2 py-0.5 text-xs text-amber-200"
          title={`Backup status unavailable: ${error}`}
        >
          Backup unknown
        </span>
      );
    }
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${tierBadgeClass(trust.tier)}`}
        title={`${summary.verification} · Safe destructive actions: ${summary.safeDestructive}`}
      >
        <TierIcon tier={trust.tier} />
        {backupTrustTierLabelForKind(newestKind, trust.tier)}
      </span>
    );
  }

  return (
    <section
      className="rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950/40"
      aria-label="Backup status"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Backup status
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">
            {backupKindExplanation(newestKind)}
          </p>
        </div>
        {!loading && !error ? (
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium ${tierBadgeClass(trust.tier)}`}
          >
            <TierIcon tier={trust.tier} />
            {backupTrustTierLabelForKind(newestKind, trust.tier)}
          </span>
        ) : null}
      </div>

      <div className="border-t border-zinc-100 px-4 py-3 dark:border-zinc-800/60">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading backup status…
          </div>
        ) : error ? (
          <p className="text-sm text-amber-800 dark:text-amber-200" role="alert">
            Could not load backup status: {error}.{" "}
            <button
              type="button"
              onClick={() => onRefresh()}
              className="font-medium underline underline-offset-2"
            >
              Retry
            </button>
          </p>
        ) : (
          <>
            <dl className="grid gap-2 text-sm sm:grid-cols-[9rem_1fr] sm:gap-x-3">
              <dt className="text-zinc-500 dark:text-zinc-500">Latest backup</dt>
              <dd className="font-medium text-zinc-800 dark:text-zinc-200">
                {latestDisplay}
              </dd>
              <dt className="text-zinc-500 dark:text-zinc-500">Verification</dt>
              <dd className="text-zinc-800 dark:text-zinc-200">{summary.verification}</dd>
              <dt className="text-zinc-500 dark:text-zinc-500">
                Safe destructive actions
              </dt>
              <dd
                className={
                  trust.allowsDestructiveWithoutOverride
                    ? "font-medium text-emerald-700 dark:text-emerald-400"
                    : "font-medium text-amber-800 dark:text-amber-300"
                }
              >
                {summary.safeDestructive}
              </dd>
            </dl>
            {!trust.allowsDestructiveWithoutOverride && summary.actionHint ? (
              <p className="mt-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                {summary.actionHint}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              <button
                type="button"
                onClick={() => scrollToProjectDatabaseTools(slug)}
                className="text-sm font-medium text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
              >
                Open Database tools
              </button>
              <button
                type="button"
                onClick={() => onRefresh()}
                className="text-sm text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
              >
                Refresh status
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

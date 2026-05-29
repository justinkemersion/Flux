"use client";

import {
  BACKUP_TRUST_REMEDIATION_CLI,
  classifyNewestBackup,
  type BackupKind,
  type BackupTrustClassification,
  type BackupTrustInput,
} from "@flux/core/backup-trust";
import { useCallback, useEffect, useMemo, useState } from "react";

export type ProjectBackupRow = {
  id: string;
  kind?: BackupKind;
  status: string;
  sizeBytes?: number | null;
  createdAt?: string | null;
  offsiteStatus?: string | null;
  artifactValidationStatus?: string | null;
  restoreVerificationStatus?: string | null;
};

export async function fetchProjectBackups(hash: string): Promise<ProjectBackupRow[]> {
  const res = await fetch(`/api/cli/v1/projects/${encodeURIComponent(hash)}/backups`);
  const body = (await res.json()) as { backups?: ProjectBackupRow[]; error?: string };
  if (!res.ok) {
    throw new Error(body.error || `Request failed (${String(res.status)})`);
  }
  return Array.isArray(body.backups) ? body.backups : [];
}

/** Short tooltip / aria text when destructive actions are blocked in the dashboard. */
export function destructiveActionBlockedTitle(
  trust: BackupTrustClassification,
  options?: { loading?: boolean; fetchError?: string | null },
): string {
  if (options?.loading) return "Checking whether the latest backup is restore-verified…";
  if (options?.fetchError) {
    return `Could not load backup status (${options.fetchError}). Open Database tools to refresh.`;
  }
  if (trust.allowsDestructiveWithoutOverride) return "";
  return `${trust.detail} Create and verify a backup first (${BACKUP_TRUST_REMEDIATION_CLI}), or use Database tools below.`;
}

export function scrollToProjectDatabaseTools(slug: string): void {
  document.getElementById(`database-${slug}`)?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

export function useProjectBackupTrust(
  hash: string,
  options?: { enabled?: boolean },
): {
  backups: ProjectBackupRow[];
  trust: BackupTrustClassification;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const enabled = options?.enabled ?? true;
  const [backups, setBackups] = useState<ProjectBackupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trust = useMemo(
    () => classifyNewestBackup(backups as BackupTrustInput[]),
    [backups],
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!hash) return;
    setLoading(true);
    setError(null);
    try {
      setBackups(await fetchProjectBackups(hash));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [hash]);

  useEffect(() => {
    if (!enabled || !hash) return;
    void refresh();
  }, [enabled, hash, refresh]);

  return { backups, trust, loading, error, refresh };
}

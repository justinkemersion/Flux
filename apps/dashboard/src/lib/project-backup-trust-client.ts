"use client";

import {
  backupTrustBlockedGuidance,
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
  primaryArtifactAbsolutePath?: string | null;
  localArtifactStatus?: "present" | "missing";
  offsiteStatus?: string | null;
  offsiteProvider?: string | null;
  offsiteBucket?: string | null;
  offsiteKey?: string | null;
  offsiteCompletedAt?: string | null;
  offsiteSizeBytes?: number | null;
  offsiteEtag?: string | null;
  offsiteContentSha256?: string | null;
  offsiteError?: string | null;
  offsiteR2Status?: "uploaded" | "failed" | "missing" | "disabled";
  r2OffsiteEnabled?: boolean;
  artifactValidationStatus?: string | null;
  restoreVerificationStatus?: string | null;
};

export type PlatformMinimumBackupFreshnessPayload = {
  effectivePolicy: {
    intervalDays: number;
    retentionCount: number;
    retentionDays: number;
  };
  freshness: {
    tier: "fresh" | "stale" | "never_verified" | "no_backups";
    ageDays?: number | null;
    dueInDays?: number | null;
    latestRestoreVerifiedAt?: string | null;
    platformBackupCompliant: boolean;
    detail: string;
  };
};

export type ProjectBackupsFetchResult = {
  backups: ProjectBackupRow[];
  platformMinimumBackupFreshness?: PlatformMinimumBackupFreshnessPayload;
};

export async function fetchProjectBackups(
  hash: string,
): Promise<ProjectBackupsFetchResult> {
  const res = await fetch(`/api/cli/v1/projects/${encodeURIComponent(hash)}/backups`);
  const body = (await res.json()) as {
    backups?: ProjectBackupRow[];
    platformMinimumBackupFreshness?: PlatformMinimumBackupFreshnessPayload;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(body.error || `Request failed (${String(res.status)})`);
  }
  return {
    backups: Array.isArray(body.backups) ? body.backups : [],
    ...(body.platformMinimumBackupFreshness
      ? { platformMinimumBackupFreshness: body.platformMinimumBackupFreshness }
      : {}),
  };
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
  return `${backupTrustBlockedGuidance(trust)} Open Database tools to create or verify a backup.`;
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
  platformMinimumBackupFreshness: PlatformMinimumBackupFreshnessPayload | null;
  trust: BackupTrustClassification;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const enabled = options?.enabled ?? true;
  const [backups, setBackups] = useState<ProjectBackupRow[]>([]);
  const [platformMinimumBackupFreshness, setPlatformMinimumBackupFreshness] =
    useState<PlatformMinimumBackupFreshnessPayload | null>(null);
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
      const result = await fetchProjectBackups(hash);
      setBackups(result.backups);
      setPlatformMinimumBackupFreshness(
        result.platformMinimumBackupFreshness ?? null,
      );
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

  return { backups, platformMinimumBackupFreshness, trust, loading, error, refresh };
}

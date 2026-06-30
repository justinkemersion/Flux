/**
 * Sanitize backup-related API payloads for MCP output and audit metadata.
 * Never expose artifact paths, volume roots, offsite storage details, or raw rows.
 */

import {
  classifyNewestBackup,
  type BackupTrustInput,
  type BackupTrustTier,
} from "@flux/core/backup-trust";
import type { ListProjectBackupsResult, ProjectBackup } from "@flux/cli/api-client";

/** Keys stripped from any MCP-facing backup object (including nested). */
export const BACKUP_STORAGE_KEY_RE =
  /(path|artifact|volume|offsite|bucket|signed|url|etag|checksum|local|provider|reconciled|password|secret|credential)/i;

/** Path-like string patterns redacted in audit values. */
const PATH_LIKE_VALUE_RE =
  /(\/srv\/|\/var\/|\/app\/|primaryArtifact|\.dump\b|offsiteKey|backupVolume)/i;

export interface SanitizedBackupItem {
  backupId: string;
  status: string;
  kind?: "project_db" | "tenant_export";
  format?: string;
  createdAt: string | null;
  completedAt?: string | null;
  artifactValidationStatus?: string | null;
  artifactValid?: boolean;
  restoreVerificationStatus?: string | null;
  restoreVerified?: boolean;
  trustTier: BackupTrustTier;
  detail: string;
  sizeBytes?: number | null;
}

export interface SanitizedBackupListData {
  backups: SanitizedBackupItem[];
  platformBackupCompliant?: boolean;
  newestTrustTier?: BackupTrustTier;
  newestDetail?: string;
}

function artifactValidFromStatus(status: string | null | undefined): boolean | undefined {
  if (status == null) return undefined;
  const s = status.trim();
  if (s === "artifact_valid") return true;
  if (s === "pending") return undefined;
  return false;
}

function restoreVerifiedFromStatus(status: string | null | undefined): boolean | undefined {
  if (status == null) return undefined;
  const s = status.trim();
  if (s === "restore_verified") return true;
  if (s === "pending") return undefined;
  return false;
}

export function sanitizeBackupRow(row: ProjectBackup): SanitizedBackupItem {
  const classification = classifyNewestBackup([row as unknown as BackupTrustInput]);
  const art = row.artifactValidationStatus ?? null;
  const restore = row.restoreVerificationStatus ?? null;

  const item: SanitizedBackupItem = {
    backupId: row.id,
    status: row.status,
    createdAt: row.createdAt ?? null,
    trustTier: classification.tier,
    detail: classification.detail,
    ...(row.kind !== undefined ? { kind: row.kind } : {}),
    ...(row.format !== undefined ? { format: row.format } : {}),
    ...(row.completedAt !== undefined ? { completedAt: row.completedAt ?? null } : {}),
    ...(art !== null ? { artifactValidationStatus: art } : {}),
    ...(restore !== null ? { restoreVerificationStatus: restore } : {}),
    ...(row.sizeBytes !== undefined ? { sizeBytes: row.sizeBytes ?? null } : {}),
  };

  const artifactValid = artifactValidFromStatus(art);
  if (artifactValid !== undefined) item.artifactValid = artifactValid;
  const restoreVerified = restoreVerifiedFromStatus(restore);
  if (restoreVerified !== undefined) item.restoreVerified = restoreVerified;

  return item;
}

export function sanitizeBackupListForMcp(
  result: ListProjectBackupsResult,
): SanitizedBackupListData {
  const backups = result.backups.map((row) => sanitizeBackupRow(row));
  const newest = result.backups.length > 0 ? classifyNewestBackup(result.backups) : undefined;
  const platformBackupCompliant =
    result.platformMinimumBackupFreshness?.freshness.platformBackupCompliant;

  return {
    backups,
    ...(platformBackupCompliant !== undefined ? { platformBackupCompliant } : {}),
    ...(newest ? { newestTrustTier: newest.tier, newestDetail: newest.detail } : {}),
  };
}

/** Keys dropped from flat backup metadata (intent/audit). */
export function sanitizeBackupMetadata(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (BACKUP_STORAGE_KEY_RE.test(key)) continue;
    out[key] = val;
  }
  return out;
}

/** Deep-remove storage keys and redact path-like strings (audit defense-in-depth). */
export function deepSanitizeBackupValue(value: unknown): unknown {
  if (typeof value === "string") {
    return PATH_LIKE_VALUE_RE.test(value) ? "[redacted]" : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepSanitizeBackupValue(item));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (BACKUP_STORAGE_KEY_RE.test(key)) {
        out[key] = "[redacted]";
        continue;
      }
      out[key] = deepSanitizeBackupValue(val);
    }
    return out;
  }
  return value;
}

export function platformBackupCompliantFromList(
  result: Pick<ListProjectBackupsResult, "platformMinimumBackupFreshness">,
): boolean | undefined {
  return result.platformMinimumBackupFreshness?.freshness.platformBackupCompliant;
}

/** Test helper: true when serialized payload contains forbidden backup storage fields. */
export function containsBackupStorageLeak(value: unknown): boolean {
  const text = JSON.stringify(value);
  const forbidden = [
    /\/srv\//,
    /primaryArtifact/,
    /offsiteKey/,
    /offsiteBucket/,
    /offsiteProvider/,
    /backupVolumeAbsoluteRoot/,
    /checksumSha256/,
    /localArtifactStatus/,
    /r2OffsiteEnabled/,
  ];
  return forbidden.some((re) => re.test(text));
}

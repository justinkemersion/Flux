import {
  classifyNewestBackup,
  destructiveBackupCheckMessage,
  type BackupTrustClassification,
  type BackupTrustInput,
} from "@flux/core/backup-trust";
import {
  listBackupsForProject,
  reconcileListedBackupArtifacts,
  type BackupRow,
} from "@/src/lib/project-backups";

export const DESTRUCTIVE_BACKUP_BLOCKED_STATUS = 412;

export function backupRowToTrustInput(row: BackupRow): BackupTrustInput {
  const kind =
    row.kind === "tenant_export" || row.kind === "project_db"
      ? row.kind
      : "project_db";
  return {
    status: row.status,
    artifactValidationStatus: row.artifactValidationStatus,
    restoreVerificationStatus: row.restoreVerificationStatus,
    kind,
  };
}

export function parseSkipBackupCheckParam(
  value: string | null | undefined,
): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export async function classifyProjectBackupTrust(
  projectId: string,
): Promise<BackupTrustClassification> {
  const rows = await listBackupsForProject(projectId);
  const reconciled = await reconcileListedBackupArtifacts(rows);
  return classifyNewestBackup(reconciled.map(backupRowToTrustInput));
}

/**
 * Throws when the newest backup is not restore-verified (same bar as `flux nuke`).
 */
export async function assertDestructiveBackupAllowed(
  projectId: string,
  options?: { skipBackupCheck?: boolean },
): Promise<BackupTrustClassification> {
  const classification = await classifyProjectBackupTrust(projectId);
  if (options?.skipBackupCheck) {
    return classification;
  }
  if (!classification.allowsDestructiveWithoutOverride) {
    throw new Error(destructiveBackupCheckMessage(classification));
  }
  return classification;
}

export function destructiveBackupBlockedResponse(message: string): Response {
  return Response.json({ error: message }, {
    status: DESTRUCTIVE_BACKUP_BLOCKED_STATUS,
  });
}

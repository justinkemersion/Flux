/**
 * Shared classification for Flux project backups (CLI + dashboard).
 * Lists are expected newest-first (same order as `listBackupsForProject`).
 * On the server, GET `/cli/v1/projects/:hash/backups` reconciles recent complete rows
 * against disk (existence, size, checksum) before responding so `artifact_valid` /
 * `restore_verified` match storage truth.
 */

export type BackupKind = "project_db" | "tenant_export";

export type BackupTrustInput = {
  status: string;
  artifactValidationStatus?: string | null | undefined;
  restoreVerificationStatus?: string | null | undefined;
  /** Catalog discriminator; when omitted, labels match legacy dedicated-project copy. */
  kind?: BackupKind | null | undefined;
};

export type BackupTrustTier =
  | "restorable"
  | "not_restore_verified"
  | "restore_failed"
  /** Artifact row still pending — distinct from a broken or invalid artifact */
  | "artifact_pending"
  | "pipeline_incomplete"
  | "latest_not_complete"
  | "no_backups";

export type BackupTrustClassification = {
  tier: BackupTrustTier;
  /** True only when latest row is complete, artifact_valid, and restore_verified. */
  allowsDestructiveWithoutOverride: boolean;
  /** Operator-facing detail (errors, CLI summary). */
  detail: string;
};

export const BACKUP_TRUST_REMEDIATION_CLI =
  "flux backup create && flux backup verify --latest";

/** Short label for UI badges when backup kind is known (no emoji). */
export function backupTrustTierLabelForKind(
  kind: BackupKind | null | undefined,
  tier: BackupTrustTier,
): string {
  const k = kind ?? "project_db";
  if (k === "project_db") {
    return backupTrustTierLabel(tier);
  }
  switch (tier) {
    case "restorable":
      return "Restorable tenant export";
    case "not_restore_verified":
      return "Created tenant export, not restore-verified";
    case "restore_failed":
      return "Tenant export restore verification failed";
    case "artifact_pending":
      return "Validating tenant export artifact";
    case "pipeline_incomplete":
      return "Tenant export artifact not valid";
    case "latest_not_complete":
      return "Latest tenant export not complete";
    case "no_backups":
      return "No tenant exports";
    default: {
      const _x: never = tier;
      return _x;
    }
  }
}

/** Short label for UI badges (no emoji). */
export function backupTrustTierLabel(tier: BackupTrustTier): string {
  switch (tier) {
    case "restorable":
      return "Restorable";
    case "not_restore_verified":
      return "Created, not restore-verified";
    case "restore_failed":
      return "Restore verification failed";
    case "artifact_pending":
      return "Validating backup artifact";
    case "pipeline_incomplete":
      return "Backup artifact not valid";
    case "latest_not_complete":
      return "Latest backup not complete";
    case "no_backups":
      return "No backups";
    default: {
      const _x: never = tier;
      return _x;
    }
  }
}

/**
 * Classify trust using only the newest backup row (`backups[0]`).
 */
export function classifyNewestBackup(
  backups: readonly BackupTrustInput[],
): BackupTrustClassification {
  if (backups.length === 0) {
    return {
      tier: "no_backups",
      allowsDestructiveWithoutOverride: false,
      detail: "No backups exist for this project.",
    };
  }

  const latest = backups[0]!;
  const art = (latest.artifactValidationStatus ?? "pending").trim();
  const restore = (latest.restoreVerificationStatus ?? "pending").trim();

  if (latest.status !== "complete") {
    return {
      tier: "latest_not_complete",
      allowsDestructiveWithoutOverride: false,
      detail: `Latest backup status is "${latest.status}", not complete.`,
    };
  }

  /** Successful restore verify proves the artifact is usable even if catalog flags lag. */
  if (restore === "restore_verified") {
    return {
      tier: "restorable",
      allowsDestructiveWithoutOverride: true,
      detail: "Latest backup is restore-verified.",
    };
  }

  if (restore === "restore_failed" || restore === "skipped") {
    return {
      tier: "restore_failed",
      allowsDestructiveWithoutOverride: false,
      detail:
        restore === "skipped"
          ? "Restore verification was skipped (e.g. invalid artifact)."
          : "Latest backup failed restore verification.",
    };
  }

  if (art === "pending") {
    return {
      tier: "artifact_pending",
      allowsDestructiveWithoutOverride: false,
      detail:
        "The newest backup finished uploading; artifact validation is still updating. This is normal—wait briefly or refresh status.",
    };
  }

  if (art !== "artifact_valid") {
    return {
      tier: "pipeline_incomplete",
      allowsDestructiveWithoutOverride: false,
      detail: `Latest backup artifact is not valid (status: ${art}).`,
    };
  }

  return {
    tier: "not_restore_verified",
    allowsDestructiveWithoutOverride: false,
    detail: "Latest backup is complete and artifact-valid but not restore-verified.",
  };
}

export function destructiveBackupCheckMessage(c: BackupTrustClassification): string {
  const hint = `Run \`${BACKUP_TRUST_REMEDIATION_CLI}\` first, or pass --skip-backup-check (dangerous).`;
  return `Latest backup is not restore-verified. ${hint}\n(${c.detail})`;
}

import test from "node:test";
import assert from "node:assert/strict";
import {
  backupTrustTierLabel,
  backupTrustTierLabelForKind,
  classifyNewestBackup,
  destructiveBackupCheckMessage,
  type BackupTrustInput,
} from "./backup-trust.ts";

test("no backups", () => {
  const c = classifyNewestBackup([]);
  assert.equal(c.tier, "no_backups");
  assert.equal(c.allowsDestructiveWithoutOverride, false);
});

test("restorable", () => {
  const rows: BackupTrustInput[] = [
    {
      status: "complete",
      artifactValidationStatus: "artifact_valid",
      restoreVerificationStatus: "restore_verified",
    },
  ];
  const c = classifyNewestBackup(rows);
  assert.equal(c.tier, "restorable");
  assert.equal(c.allowsDestructiveWithoutOverride, true);
});

test("not restore-verified: pending verify", () => {
  const rows: BackupTrustInput[] = [
    {
      status: "complete",
      artifactValidationStatus: "artifact_valid",
      restoreVerificationStatus: "pending",
    },
  ];
  const c = classifyNewestBackup(rows);
  assert.equal(c.tier, "not_restore_verified");
  assert.equal(c.allowsDestructiveWithoutOverride, false);
});

test("restore_failed", () => {
  const rows: BackupTrustInput[] = [
    {
      status: "complete",
      artifactValidationStatus: "artifact_valid",
      restoreVerificationStatus: "restore_failed",
    },
  ];
  const c = classifyNewestBackup(rows);
  assert.equal(c.tier, "restore_failed");
  assert.equal(c.allowsDestructiveWithoutOverride, false);
});

test("skipped restore verification", () => {
  const rows: BackupTrustInput[] = [
    {
      status: "complete",
      artifactValidationStatus: "artifact_valid",
      restoreVerificationStatus: "skipped",
    },
  ];
  const c = classifyNewestBackup(rows);
  assert.equal(c.tier, "restore_failed");
});

test("latest incomplete (e.g. failed backup)", () => {
  const rows: BackupTrustInput[] = [
    { status: "failed", artifactValidationStatus: "pending", restoreVerificationStatus: "pending" },
  ];
  const c = classifyNewestBackup(rows);
  assert.equal(c.tier, "latest_not_complete");
  assert.equal(c.allowsDestructiveWithoutOverride, false);
});

test("artifact pending on complete row", () => {
  const rows: BackupTrustInput[] = [
    {
      status: "complete",
      artifactValidationStatus: "pending",
      restoreVerificationStatus: "pending",
    },
  ];
  const c = classifyNewestBackup(rows);
  assert.equal(c.tier, "artifact_pending");
});

test("restore-verified counts as restorable even if artifact flag still pending", () => {
  const rows: BackupTrustInput[] = [
    {
      status: "complete",
      artifactValidationStatus: "pending",
      restoreVerificationStatus: "restore_verified",
    },
  ];
  const c = classifyNewestBackup(rows);
  assert.equal(c.tier, "restorable");
  assert.equal(c.allowsDestructiveWithoutOverride, true);
});

test("destructive message includes remediation", () => {
  const c = classifyNewestBackup([]);
  const msg = destructiveBackupCheckMessage(c);
  assert.match(msg, /flux backup create/);
  assert.match(msg, /--skip-backup-check/);
});

test("backupTrustTierLabelForKind tenant_export restorable", () => {
  assert.equal(
    backupTrustTierLabelForKind("tenant_export", "restorable"),
    "Restorable tenant export",
  );
});

test("backupTrustTierLabelForKind defaults project_db to legacy label helper", () => {
  assert.equal(
    backupTrustTierLabelForKind("project_db", "restorable"),
    backupTrustTierLabel("restorable"),
  );
});

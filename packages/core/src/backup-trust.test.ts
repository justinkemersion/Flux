import test from "node:test";
import assert from "node:assert/strict";
import {
  backupSafeDestructiveLabel,
  backupTrustBlockedGuidance,
  backupTrustTierLabel,
  backupTrustTierLabelForKind,
  backupVerificationStatusLabel,
  classifyNewestBackup,
  destructiveBackupCheckMessage,
  formatBackupTrustSummary,
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

test("backupVerificationStatusLabel restorable", () => {
  assert.equal(backupVerificationStatusLabel("restorable"), "Restore-verified");
});

test("backupSafeDestructiveLabel", () => {
  assert.equal(backupSafeDestructiveLabel(true), "Allowed");
  assert.equal(backupSafeDestructiveLabel(false), "Blocked until verification");
});

test("backupTrustBlockedGuidance uses confidence-not-punishment copy", () => {
  const c = classifyNewestBackup([
    {
      status: "complete",
      artifactValidationStatus: "artifact_valid",
      restoreVerificationStatus: "pending",
    },
  ]);
  assert.match(backupTrustBlockedGuidance(c), /has not been restore-verified/);
  assert.match(backupTrustBlockedGuidance(c), /recovery path/);
});

test("formatBackupTrustSummary restorable", () => {
  const c = classifyNewestBackup([
    {
      status: "complete",
      artifactValidationStatus: "artifact_valid",
      restoreVerificationStatus: "restore_verified",
    },
  ]);
  const s = formatBackupTrustSummary({
    classification: c,
    kind: "tenant_export",
    latestBackupCreatedAt: "2026-06-21T14:22:00.000Z",
  });
  assert.equal(s.latestBackup, "2026-06-21T14:22:00.000Z");
  assert.equal(s.verification, "Restore-verified");
  assert.equal(s.safeDestructive, "Allowed");
  assert.equal(s.actionHint, undefined);
});

test("formatBackupTrustSummary blocked includes action hint", () => {
  const c = classifyNewestBackup([]);
  const s = formatBackupTrustSummary({ classification: c, kind: "project_db" });
  assert.equal(s.latestBackup, "None yet");
  assert.equal(s.safeDestructive, "Blocked until verification");
  assert.match(s.actionHint ?? "", /flux backup create/);
});

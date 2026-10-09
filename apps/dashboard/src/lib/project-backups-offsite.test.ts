import test from "node:test";
import assert from "node:assert/strict";
import { classifyNewestBackup } from "@flux/core/backup-trust";
import {
  BACKUP_CREATE_FAILED_SKIP_REASON,
  BACKUP_OFFSITE_FAILED_SKIP_REASON,
  failedBackupCatalogPatch,
  formatLocalArtifactStatus,
  formatOffsiteR2StatusForRow,
} from "./project-backups.js";

test("failed create and strict offsite failure mark validation and restore skipped", () => {
  const created = failedBackupCatalogPatch("pg_dump exited 1");
  assert.equal(created.status, "failed");
  assert.equal(created.artifactValidationStatus, "skipped");
  assert.equal(created.restoreVerificationStatus, "skipped");
  assert.equal(created.artifactValidationError, BACKUP_CREATE_FAILED_SKIP_REASON);
  assert.equal(created.restoreVerificationError, BACKUP_CREATE_FAILED_SKIP_REASON);
  assert.notEqual(created.artifactValidationStatus, "pending");
  assert.notEqual(created.restoreVerificationStatus, "pending");

  const offsite = failedBackupCatalogPatch(
    "Offsite replication failed (strict mode): getaddrinfo EAI_AGAIN",
  );
  assert.equal(offsite.status, "failed");
  assert.equal(offsite.artifactValidationStatus, "skipped");
  assert.equal(offsite.restoreVerificationStatus, "skipped");
  assert.equal(offsite.artifactValidationError, BACKUP_OFFSITE_FAILED_SKIP_REASON);
  assert.equal(offsite.restoreVerificationError, BACKUP_OFFSITE_FAILED_SKIP_REASON);
});

test("formatLocalArtifactStatus", () => {
  assert.equal(
    formatLocalArtifactStatus({ status: "complete", artifactValidationStatus: "pending" }),
    "present",
  );
  assert.equal(
    formatLocalArtifactStatus({ status: "complete", artifactValidationStatus: "artifact_invalid" }),
    "missing",
  );
  assert.equal(
    formatLocalArtifactStatus({ status: "running", artifactValidationStatus: "pending" }),
    "missing",
  );
});

test("offsite complete does not make backup restorable without restore verify", () => {
  const c = classifyNewestBackup([
    {
      status: "complete",
      artifactValidationStatus: "artifact_valid",
      restoreVerificationStatus: "pending",
    },
  ]);
  assert.equal(c.tier, "not_restore_verified");
  assert.equal(c.allowsDestructiveWithoutOverride, false);
});

test("formatOffsiteR2StatusForRow when R2 disabled", () => {
  const prev = process.env.FLUX_R2_BACKUPS_ENABLED;
  process.env.FLUX_R2_BACKUPS_ENABLED = "false";
  try {
    assert.equal(
      formatOffsiteR2StatusForRow({ offsiteStatus: "complete" }),
      "disabled",
    );
  } finally {
    if (prev === undefined) delete process.env.FLUX_R2_BACKUPS_ENABLED;
    else process.env.FLUX_R2_BACKUPS_ENABLED = prev;
  }
});

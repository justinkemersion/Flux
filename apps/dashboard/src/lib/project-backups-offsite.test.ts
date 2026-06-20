import test from "node:test";
import assert from "node:assert/strict";
import { classifyNewestBackup } from "@flux/core/backup-trust";
import {
  formatLocalArtifactStatus,
  formatOffsiteR2StatusForRow,
} from "./project-backups.js";

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

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BACKUP_STORAGE_KEY_RE,
  containsBackupStorageLeak,
  deepSanitizeBackupValue,
  sanitizeBackupListForMcp,
  sanitizeBackupMetadata,
  sanitizeBackupRow,
} from "./backup-sanitize";

const RAW_ROW = {
  id: "351a7c7f-80ce-4dcc-863a-e278d496eea8",
  kind: "tenant_export" as const,
  format: "pg_custom",
  status: "complete",
  sizeBytes: 12345,
  checksumSha256: "abc123",
  createdAt: "2026-06-27T15:31:45.367Z",
  completedAt: "2026-06-27T15:31:50.000Z",
  primaryArtifactRelativePath: "proj/351a.dump",
  primaryArtifactAbsolutePath: "/srv/flux/backups/proj/351a.dump",
  localArtifactStatus: "present" as const,
  offsiteStatus: "complete",
  offsiteProvider: "r2",
  offsiteBucket: "flux-backups",
  offsiteKey: "tenant/hash/351a.dump",
  offsiteEtag: "etag",
  r2OffsiteEnabled: true,
  artifactValidationStatus: "artifact_valid",
  restoreVerificationStatus: "restore_verified",
};

test("sanitizeBackupRow keeps safe fields only", () => {
  const row = sanitizeBackupRow(RAW_ROW);
  assert.equal(row.backupId, RAW_ROW.id);
  assert.equal(row.status, "complete");
  assert.equal(row.trustTier, "restorable");
  assert.equal(row.restoreVerified, true);
  assert.equal(row.artifactValid, true);
  assert.equal(row.sizeBytes, 12345);
  assert.equal(containsBackupStorageLeak(row), false);
});

test("sanitizeBackupListForMcp removes storage leaks from full list response", () => {
  const data = sanitizeBackupListForMcp({
    backups: [RAW_ROW],
    backupVolumeAbsoluteRoot: "/srv/flux/backups",
    reconciledAt: "2026-06-30T00:00:00.000Z",
    platformMinimumBackupFreshness: {
      effectivePolicy: { intervalDays: 7, retentionCount: 4, retentionDays: 30 },
      freshness: {
        tier: "fresh",
        platformBackupCompliant: true,
        detail: "ok",
      },
    },
  });
  assert.equal(data.backups.length, 1);
  assert.equal(data.platformBackupCompliant, true);
  assert.equal(data.newestTrustTier, "restorable");
  assert.equal(containsBackupStorageLeak(data), false);
});

test("sanitizeBackupMetadata strips storage keys", () => {
  const out = sanitizeBackupMetadata({
    backupId: "b1",
    offsiteKey: "secret/key",
    primaryArtifactAbsolutePath: "/srv/x",
    verified: true,
  });
  assert.equal(out.backupId, "b1");
  assert.equal(out.verified, true);
  assert.equal("offsiteKey" in out, false);
  assert.equal("primaryArtifactAbsolutePath" in out, false);
});

test("deepSanitizeBackupValue redacts nested path and storage fields", () => {
  const out = deepSanitizeBackupValue({
    backups: [
      {
        id: "b1",
        primaryArtifactAbsolutePath: "/srv/flux/backups/b1.dump",
        offsiteBucket: "flux-backups",
      },
    ],
    backupVolumeAbsoluteRoot: "/srv/flux",
  }) as Record<string, unknown>;
  const backups = out.backups as Record<string, unknown>[];
  assert.equal(backups[0]!.primaryArtifactAbsolutePath, "[redacted]");
  assert.equal(backups[0]!.offsiteBucket, "[redacted]");
  assert.equal(out.backupVolumeAbsoluteRoot, "[redacted]");
});

test("BACKUP_STORAGE_KEY_RE matches expected forbidden key names", () => {
  assert.equal(BACKUP_STORAGE_KEY_RE.test("offsiteKey"), true);
  assert.equal(BACKUP_STORAGE_KEY_RE.test("primaryArtifactAbsolutePath"), true);
  assert.equal(BACKUP_STORAGE_KEY_RE.test("backupId"), false);
  assert.equal(BACKUP_STORAGE_KEY_RE.test("status"), false);
});

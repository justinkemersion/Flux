import { test } from "node:test";
import assert from "node:assert/strict";
import type { FluxToolClient } from "./index";
import { runBackupEnsureVerified } from "./backup-ensure";

const VERIFIED_BACKUP = {
  id: "backup-verified",
  format: "custom",
  status: "complete",
  artifactValidationStatus: "artifact_valid",
  restoreVerificationStatus: "restore_verified",
  createdAt: new Date().toISOString(),
};

function fakeClient(overrides: Partial<FluxToolClient>): FluxToolClient {
  const base: FluxToolClient = {
    listProjects: async () => [],
    getProjectMetadata: async () => ({ slug: "s", hash: "abc1234", mode: "v2_shared" }),
    getProjectLifecycleState: async () => {
      throw new Error("unused");
    },
    fetchProjectFluxMdDetail: async () => {
      throw new Error("unused");
    },
    schemaInspectProject: async () => {
      throw new Error("unused");
    },
    listAppliedMigrations: async () => [],
    runDoctor: async () => {
      throw new Error("unused");
    },
    fetchProjectActivity: async () => ({ projectSlug: "s", hash: "abc1234", events: [] }),
    listProjectBackups: async () => ({ backups: [VERIFIED_BACKUP] }),
    createProjectBackup: async () => {
      throw new Error("create should not be called");
    },
    verifyProjectBackup: async () => {
      throw new Error("verify should not be called");
    },
    getProjectDbAccessPlan: async () => ({ mode: "v2_shared" } as never),
    createTemporaryProjectDbCredential: async () => {
      throw new Error("unused");
    },
    recordMcpAuditEvent: async () => ({ ok: true, auditId: "a1" }),
    createMcpIntent: async () => ({ intentId: "intent-1", status: "pending" }),
    updateMcpIntent: async () => ({ intentId: "intent-1", status: "completed" }),
    pushSql: async () => ({ tablesMoved: 0, sequencesMoved: 0, viewsMoved: 0 }),
  };
  return { ...base, ...overrides };
}

test("fresh restore-verified backup does not create a new backup", async () => {
  let createCalls = 0;
  const client = fakeClient({
    createProjectBackup: async () => {
      createCalls += 1;
      return { backup: { id: "new", format: "custom", status: "complete" } };
    },
  });
  const res = await runBackupEnsureVerified(
    client,
    { hash: "abc1234", verifyLatestIfFresh: true },
    { intentId: "intent-1" },
  );
  assert.equal(res.ok, true);
  assert.equal(createCalls, 0);
  const data = res.data as { created: boolean; verified: boolean; trustTier: string };
  assert.equal(data.created, false);
  assert.equal(data.verified, true);
  assert.equal(data.trustTier, "restorable");
});

test("stale backup creates and verifies", async () => {
  let createCalls = 0;
  let verifyCalls = 0;
  let listCalls = 0;
  const stale = {
    ...VERIFIED_BACKUP,
    createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
  };
  const verifiedNew = {
    id: "backup-new",
    format: "custom",
    status: "complete",
    artifactValidationStatus: "artifact_valid",
    restoreVerificationStatus: "restore_verified",
    createdAt: new Date().toISOString(),
  };
  const client = fakeClient({
    listProjectBackups: async () => {
      listCalls += 1;
      if (listCalls === 1) return { backups: [stale] };
      return { backups: [verifiedNew] };
    },
    createProjectBackup: async () => {
      createCalls += 1;
      return {
        backup: {
          id: "backup-new",
          format: "custom",
          status: "complete",
          artifactValidationStatus: "artifact_valid",
        },
      };
    },
    verifyProjectBackup: async () => {
      verifyCalls += 1;
      return { ok: true, backupId: "backup-new", restoreVerificationStatus: "restore_verified" };
    },
  });
  const res = await runBackupEnsureVerified(
    client,
    { hash: "abc1234", verifyLatestIfFresh: true, maxAgeHours: 12 },
    { intentId: "intent-1" },
    { sleepMs: async () => undefined },
  );
  assert.equal(createCalls, 1);
  assert.equal(verifyCalls, 1);
  assert.equal(res.ok, true);
  const data = res.data as { created: boolean; verified: boolean };
  assert.equal(data.created, true);
  assert.equal(data.verified, true);
});

test("verification failure returns remediation", async () => {
  const client = fakeClient({
    listProjectBackups: async () => ({ backups: [] }),
    createProjectBackup: async () => ({
      backup: {
        id: "backup-new",
        format: "custom",
        status: "complete",
        artifactValidationStatus: "artifact_valid",
      },
    }),
    verifyProjectBackup: async () => {
      throw new Error("restore verification failed");
    },
  });
  const res = await runBackupEnsureVerified(
    client,
    { hash: "abc1234" },
    { intentId: "intent-1" },
    { sleepMs: async () => undefined },
  );
  assert.equal(res.ok, false);
  assert.ok(res.remediation);
  const data = res.data as { verified: boolean };
  assert.equal(data.verified, false);
});

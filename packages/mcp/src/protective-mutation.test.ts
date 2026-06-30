import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTools, type FluxToolClient } from "./tools";
import {
  createPendingProtectiveIntent,
  intentFinalizationFailureResult,
  isProtectivePersistenceAvailable,
  updateProtectiveIntentTerminal,
} from "./protective-mutation";

function minimalClient(overrides: Partial<FluxToolClient> = {}): FluxToolClient {
  const verified = {
    id: "b1",
    format: "custom",
    status: "complete",
    artifactValidationStatus: "artifact_valid",
    restoreVerificationStatus: "restore_verified",
    createdAt: new Date().toISOString(),
  };
  return {
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
    listProjectBackups: async () => ({ backups: [verified] }),
    createProjectBackup: async () => ({
      backup: { id: "new", format: "custom", status: "complete" },
    }),
    verifyProjectBackup: async () => ({
      ok: true,
      backupId: "new",
      restoreVerificationStatus: "restore_verified",
    }),
    getProjectDbAccessPlan: async () => ({ mode: "v2_shared" } as never),
    createTemporaryProjectDbCredential: async () => {
      throw new Error("unused");
    },
    recordMcpAuditEvent: async () => ({ ok: true, auditId: "audit-1" }),
    createMcpIntent: async () => ({ intentId: "intent-1", status: "pending" }),
    updateMcpIntent: async () => ({ intentId: "intent-1", status: "completed" }),
    pushSql: async () => ({ tablesMoved: 0, sequencesMoved: 0, viewsMoved: 0 }),
    ...overrides,
  };
}

test("isProtectivePersistenceAvailable requires audit, create, and update", () => {
  assert.equal(isProtectivePersistenceAvailable({}), false);
  assert.equal(
    isProtectivePersistenceAvailable({
      recordMcpAuditEvent: async () => ({ ok: true, auditId: "a" }),
      createMcpIntent: async () => ({ intentId: "i", status: "pending" }),
    }),
    false,
  );
  assert.equal(isProtectivePersistenceAvailable(minimalClient()), true);
});

test("createPendingProtectiveIntent failure blocks before backup handler", async () => {
  const client = minimalClient({
    createMcpIntent: async () => {
      throw new Error("intent store unavailable");
    },
  });
  const def = buildTools(client).find((d) => d.name === "flux.backup.ensureVerified");
  assert.ok(def);
  await assert.rejects(
    () => createPendingProtectiveIntent(client as never, def!, { hash: "abc1234" }),
    /intent store unavailable/,
  );
});

test("intent update failure after successful backup returns ok false with metadata", async () => {
  const client = minimalClient({
    updateMcpIntent: async () => {
      throw new Error("intent patch failed");
    },
  });
  const def = buildTools(client).find((d) => d.name === "flux.backup.ensureVerified");
  assert.ok(def);
  const handlerResult = await def!.handler({ hash: "abc1234" }, { intentId: "intent-1" });
  assert.equal(handlerResult.ok, true);

  await assert.rejects(
    () => updateProtectiveIntentTerminal(client as never, "intent-1", handlerResult),
    /intent patch failed/,
  );
  const final = intentFinalizationFailureResult(handlerResult, "intent-1");
  assert.equal(final.ok, false);
  assert.ok(final.remediation);
  const data = final.data as { verified: boolean; created: boolean };
  assert.equal(data.verified, true);
  assert.equal(data.created, false);
});

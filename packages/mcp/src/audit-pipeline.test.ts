import { test } from "node:test";
import assert from "node:assert/strict";
import { finalizeToolAudit } from "./audit-pipeline";
import { assertWriteDestructivePolicy } from "./policy";

test("finalizeToolAudit persists audit on success path", async () => {
  const auditCalls: unknown[] = [];
  const lines: string[] = [];

  await finalizeToolAudit({
    event: {
      tool: "flux.project.list",
      intentClass: "read",
      decision: "allow",
      status: "ok",
      durationMs: 3,
      args: {},
    },
    args: {},
    client: {
      recordMcpAuditEvent: async (input) => {
        auditCalls.push(input);
        return { ok: true, auditId: "a1" };
      },
      createMcpIntent: async () => ({ intentId: "i1", status: "completed" }),
    },
    warn: (m) => lines.push(m),
  });

  assert.equal(auditCalls.length, 1);
  assert.equal(lines.length, 0);
});

test("finalizeToolAudit audit failure is non-fatal for read tools", async () => {
  const warnings: string[] = [];

  await finalizeToolAudit({
    event: {
      tool: "flux.project.list",
      intentClass: "read",
      decision: "allow",
      status: "ok",
      durationMs: 1,
      args: { hash: "abc1234" },
    },
    args: { hash: "abc1234" },
    client: {
      recordMcpAuditEvent: async () => {
        throw new Error("upstream 503");
      },
      createMcpIntent: async () => ({ intentId: "i1", status: "completed" }),
    },
    warn: (m) => warnings.push(m),
  });

  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /non-fatal/i);
});

test("policy blocks write/destructive when persistent audit unavailable", () => {
  const writeBlocked = assertWriteDestructivePolicy({
    intentClass: "write",
    auditAvailable: false,
    intentRecorded: true,
    planId: "plan-1",
  });
  assert.equal(writeBlocked.allowed, false);

  const destructiveBlocked = assertWriteDestructivePolicy({
    intentClass: "destructive",
    auditAvailable: true,
    intentRecorded: true,
    backupTrustPass: false,
  });
  assert.equal(destructiveBlocked.allowed, false);
});

test("finalizeToolAudit creates intent for migration.plan with planId", async () => {
  const intents: unknown[] = [];

  await finalizeToolAudit({
    event: {
      tool: "flux.migration.plan",
      intentClass: "plan",
      decision: "allow",
      status: "ok",
      durationMs: 8,
      args: { hash: "abc1234", migrationsPath: "migrations" },
    },
    args: { hash: "abc1234", migrationsPath: "migrations" },
    result: {
      ok: true,
      summary: "ok",
      data: { planId: "plan-123", planHash: "hash-456", destructiveShaped: false },
    },
    client: {
      recordMcpAuditEvent: async () => ({ ok: true, auditId: "a1" }),
      createMcpIntent: async (input) => {
        intents.push(input);
        return { intentId: "i1", status: "completed" };
      },
    },
  });

  assert.equal(intents.length, 1);
  const intent = intents[0] as { planId?: string; planHash?: string; intentClass: string };
  assert.equal(intent.intentClass, "plan");
  assert.equal(intent.planId, "plan-123");
  assert.equal(intent.planHash, "hash-456");
});

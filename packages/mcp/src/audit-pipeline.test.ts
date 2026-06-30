import { test } from "node:test";
import assert from "node:assert/strict";
import { finalizeToolAudit } from "./audit-pipeline";
import {
  assertProtectiveMutationPolicy,
  assertWriteDestructivePolicy,
  auditPersistenceRequired,
} from "./policy";

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

test("protective mutation policy requires intent after pending create", () => {
  const blocked = assertProtectiveMutationPolicy({
    auditAvailable: true,
    intentRecorded: false,
  });
  assert.equal(blocked.allowed, false);

  const allowed = assertProtectiveMutationPolicy({
    auditAvailable: true,
    intentRecorded: true,
  });
  assert.equal(allowed.allowed, true);
});

test("protective mutation audit persistence is required", () => {
  assert.equal(auditPersistenceRequired("protective_mutation"), true);
});

test("finalizeToolAudit persists backup ensure gate without storage paths", async () => {
  const audits: unknown[] = [];

  await finalizeToolAudit({
    event: {
      tool: "flux.backup.ensureVerified",
      intentClass: "protective_mutation",
      decision: "allow",
      status: "ok",
      durationMs: 4,
      args: { hash: "abc1234" },
      skipIntentCreate: true,
      gate: "backup_ensure_reused",
      intentId: "intent-99",
    },
    args: { hash: "abc1234" },
    result: {
      ok: true,
      summary: "ok",
      data: {
        backupId: "b1",
        created: false,
        verified: true,
        trustTier: "restorable",
        detail: "Latest backup is restore-verified.",
        intentId: "intent-99",
        primaryArtifactAbsolutePath: "/secret/path.dump",
      },
    },
    client: {
      recordMcpAuditEvent: async (input) => {
        audits.push(input);
        return { ok: true, auditId: "a1" };
      },
      createMcpIntent: async () => ({ intentId: "i1", status: "completed" }),
    },
  });

  assert.equal(audits.length, 1);
  const audit = audits[0] as { gate?: string; requestSummary: Record<string, unknown> };
  assert.equal(audit.gate, "backup_ensure_reused");
  assert.equal(JSON.stringify(audit.requestSummary).includes("/secret/path"), false);
});

test("finalizeToolAudit migration apply redacts sql and paths in requestSummary", async () => {
  const audits: unknown[] = [];

  await finalizeToolAudit({
    event: {
      tool: "flux.migration.apply",
      intentClass: "write",
      decision: "allow",
      status: "ok",
      durationMs: 12,
      args: {
        hash: "abc1234",
        planId: "plan-1",
        planHash: "hash-1",
        migrationsPath: "/home/agent/proj/migrations",
        sql: "CREATE TABLE secret (pw text);",
        token: "flx_live_secret",
      },
      skipIntentCreate: true,
      gate: "migration_apply_allowed",
      intentId: "intent-42",
    },
    args: {
      hash: "abc1234",
      planId: "plan-1",
      planHash: "hash-1",
      migrationsPath: "/home/agent/proj/migrations",
      sql: "CREATE TABLE secret (pw text);",
      token: "flx_live_secret",
    },
    result: {
      ok: true,
      summary: "ok",
      data: {
        planId: "plan-1",
        planHash: "hash-1",
        appliedCount: 1,
        appliedFiles: ["0001_init.sql"],
        intentId: "intent-42",
        gate: "migration_apply_allowed",
      },
    },
    client: {
      recordMcpAuditEvent: async (input) => {
        audits.push(input);
        return { ok: true, auditId: "a1" };
      },
      createMcpIntent: async () => ({ intentId: "i1", status: "completed" }),
    },
  });

  assert.equal(audits.length, 1);
  const audit = audits[0] as { gate?: string; requestSummary: Record<string, unknown> };
  assert.equal(audit.gate, "migration_apply_allowed");
  assert.equal(audit.requestSummary.sql, "[redacted]");
  const serialized = JSON.stringify(audit.requestSummary);
  assert.equal(serialized.includes("flx_live"), false);
  assert.equal(serialized.includes("CREATE TABLE"), false);
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

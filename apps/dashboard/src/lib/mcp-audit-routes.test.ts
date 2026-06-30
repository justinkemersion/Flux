import test from "node:test";
import assert from "node:assert/strict";
import { runCliAuditPost } from "../../app/api/cli/v1/audit/route.ts";
import { runCliIntentPost } from "../../app/api/cli/v1/intents/route.ts";
import { validateMcpAuditEventInput } from "./mcp-audit.ts";
import { containsObviousSecret } from "./mcp-secret-scan.ts";

const AUTH = { userId: "user-server", keyId: "key-1" };
const PROJECT_ID = "00000000-0000-4000-8000-000000000099";

function auditBody(overrides: Record<string, unknown> = {}) {
  return {
    tool: "flux.project.list",
    intentClass: "read",
    decision: "allow",
    requestSummary: { empty: true },
    resultStatus: "ok",
    durationMs: 12,
    userId: "attacker-should-be-ignored",
    ...overrides,
  };
}

test("audit route rejects malformed payloads", async () => {
  const res = await runCliAuditPost(
    new Request("http://test/api/cli/v1/audit", {
      method: "POST",
      headers: { Authorization: "Bearer flx_live_test", "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "" }),
    }),
    {
      initSystemDb: async () => undefined,
      getDb: () => ({}) as never,
      authenticate: async () => AUTH,
    },
  );
  assert.equal(res.status, 400);
});

test("audit route rejects obvious secrets in requestSummary", () => {
  const validated = validateMcpAuditEventInput(
    auditBody({
      requestSummary: { token: "flx_live_0123456789abcdef0123456789abcdef_abcd" },
    }),
  );
  assert.equal(validated.ok, false);
  if (validated.ok) return;
  assert.match(validated.error, /secret/i);
});

test("secret scan detects JWT and postgres connection strings", () => {
  assert.equal(
    containsObviousSecret({
      note: "postgres://admin:secret@db.internal:5432/app",
    }),
    true,
  );
  assert.equal(
    containsObviousSecret({
      jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig",
    }),
    true,
  );
  assert.equal(containsObviousSecret({ hash: "abc1234" }), false);
});

test("audit route records server-owned user identity", async () => {
  let insertedUserId: string | undefined;
  const res = await runCliAuditPost(
    new Request("http://test/api/cli/v1/audit", {
      method: "POST",
      headers: { Authorization: "Bearer flx_live_test", "Content-Type": "application/json" },
      body: JSON.stringify(auditBody()),
    }),
    {
      initSystemDb: async () => undefined,
      getDb: () =>
        ({
          insert: () => ({
            values: (row: { userId: string }) => {
              insertedUserId = row.userId;
              return {
                returning: async () => [{ id: "audit-id-1" }],
              };
            },
          }),
        }) as never,
      authenticate: async () => AUTH,
    },
  );
  assert.equal(res.status, 200);
  assert.equal(insertedUserId, "user-server");
  const json = (await res.json()) as { auditId: string };
  assert.equal(json.auditId, "audit-id-1");
});

test("intent route validates project ownership", async () => {
  const res = await runCliIntentPost(
    new Request("http://test/api/cli/v1/intents", {
      method: "POST",
      headers: { Authorization: "Bearer flx_live_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "flux.migration.plan",
        intentClass: "plan",
        status: "completed",
        riskLevel: "medium",
        policyDecision: "allow",
        projectHash: "abc1234",
        requestSummary: { hash: "abc1234" },
      }),
    }),
    {
      initSystemDb: async () => undefined,
      getDb: () =>
        ({
          select: () => ({
            from: () => ({
              where: () => ({
                limit: async () => [],
              }),
            }),
          }),
        }) as never,
      authenticate: async () => AUTH,
    },
  );
  assert.equal(res.status, 404);
});

test("intent route inserts when project is owned", async () => {
  const res = await runCliIntentPost(
    new Request("http://test/api/cli/v1/intents", {
      method: "POST",
      headers: { Authorization: "Bearer flx_live_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "flux.migration.plan",
        intentClass: "plan",
        status: "completed",
        riskLevel: "medium",
        policyDecision: "allow",
        projectHash: "abc1234",
        requestSummary: { hash: "abc1234" },
      }),
    }),
    {
      initSystemDb: async () => undefined,
      getDb: () =>
        ({
          select: () => ({
            from: () => ({
              where: () => ({
                limit: async () => [{ id: PROJECT_ID }],
              }),
            }),
          }),
          insert: () => ({
            values: () => ({
              returning: async () => [{ id: "intent-id-1", status: "completed" }],
            }),
          }),
        }) as never,
      authenticate: async () => AUTH,
    },
  );
  assert.equal(res.status, 200);
  const json = (await res.json()) as { intentId: string; status: string };
  assert.equal(json.intentId, "intent-id-1");
  assert.equal(json.status, "completed");
});

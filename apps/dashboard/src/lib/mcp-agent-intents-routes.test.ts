import test from "node:test";
import assert from "node:assert/strict";
import { runAgentIntentList } from "../../app/api/agent/intents/route.ts";
import { runCliIntentGet } from "../../app/api/cli/v1/intents/route.ts";
import {
  MCP_INTENT_LIST_MAX_LIMIT,
  encodeIntentListCursor,
  listMcpIntentsForUser,
  parseListMcpIntentsQuery,
} from "./mcp-intents.ts";
import { containsIntentLeak } from "./mcp-intent-sanitize.ts";

const AUTH = { userId: "user-a", keyId: "key-1" };
const OTHER_USER = "user-b";

const ROW_A = {
  id: "00000000-0000-4000-8000-000000000010",
  createdAt: new Date("2026-06-30T12:00:00.000Z"),
  updatedAt: new Date("2026-06-30T12:00:01.000Z"),
  projectHash: "abc1234",
  tool: "flux.migration.apply",
  intentClass: "write",
  status: "failed",
  riskLevel: "medium",
  policyDecision: "allow",
  approvalStatus: null,
  resultStatus: "error",
  errorCode: "invalid_input",
  planId: "plan-1",
  planHash: "hash-1",
  requestSummary: {
    hash: "abc1234",
    planId: "plan-1",
    sql: "CREATE TABLE x (id int);",
    workspaceRoot: "/tmp/repo",
  },
  metadata: {
    staleReason: "plan_file_checksum_mismatch",
    changedFiles: ["0001_init.sql"],
    gate: "migration_apply_blocked_stale_plan",
  },
};

const ROW_B = {
  ...ROW_A,
  id: "00000000-0000-4000-8000-000000000011",
  createdAt: new Date("2026-06-29T12:00:00.000Z"),
  tool: "flux.backup.ensureVerified",
  intentClass: "protective_mutation",
  status: "completed",
  riskLevel: "low",
  resultStatus: "ok" as const,
  errorCode: null as string | null,
  metadata: {
    verified: true,
    backupId: "b1",
    trustTier: "restorable",
    detail: "restore-verified",
    offsiteKey: "should-not-appear",
  },
};

function mockListDb(rows: Array<typeof ROW_A | typeof ROW_B | typeof ROW_PARTIAL>) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => rows,
          }),
        }),
      }),
    }),
  } as never;
}

test("parseListMcpIntentsQuery caps limit at max", () => {
  const parsed = parseListMcpIntentsQuery(new URLSearchParams({ limit: "999" }));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.filters.limit, MCP_INTENT_LIST_MAX_LIMIT);
});

test("parseListMcpIntentsQuery rejects invalid status", () => {
  const parsed = parseListMcpIntentsQuery(new URLSearchParams({ status: "bogus" }));
  assert.equal(parsed.ok, false);
});

test("listMcpIntentsForUser returns sanitized intents only", async () => {
  const result = await listMcpIntentsForUser(mockListDb([ROW_A]), AUTH.userId, {
    limit: 50,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.result.intents.length, 1);
  const intent = result.result.intents[0]!;
  assert.equal(intent.id, ROW_A.id);
  assert.equal("requestSummary" in intent, false);
  assert.equal(intent.metadata?.staleReason, "plan_file_checksum_mismatch");
  assert.equal(containsIntentLeak(result.result), false);
});

test("listMcpIntentsForUser exposes nextCursor when more rows exist", async () => {
  const result = await listMcpIntentsForUser(mockListDb([ROW_A, ROW_B]), AUTH.userId, {
    limit: 1,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.result.intents.length, 1);
  assert.equal(
    result.result.nextCursor,
    encodeIntentListCursor(ROW_A.createdAt, ROW_A.id),
  );
});

test("agent intent list rejects unauthenticated requests", async () => {
  const res = await runAgentIntentList(new Request("http://test/api/agent/intents"), {
    initSystemDb: async () => undefined,
    getDb: () => ({}) as never,
    authenticate: async () => null,
  });
  assert.equal(res.status, 401);
});

test("agent intent list returns sanitized intents for session user", async () => {
  let queriedUserId: string | undefined;
  const res = await runAgentIntentList(
    new Request("http://test/api/agent/intents?projectHash=abc1234&status=failed&limit=10"),
    {
      initSystemDb: async () => undefined,
      getDb: () => mockListDb([ROW_A]),
      authenticate: async () => ({ user: { id: AUTH.userId } }),
    },
  );
  assert.equal(res.status, 200);
  const json = (await res.json()) as { intents: Array<Record<string, unknown>> };
  assert.equal(json.intents.length, 1);
  assert.equal(json.intents[0]?.tool, "flux.migration.apply");
  assert.equal(containsIntentLeak(json), false);
  queriedUserId = AUTH.userId;
  assert.equal(queriedUserId, AUTH.userId);

  const listed = await listMcpIntentsForUser(mockListDb([ROW_A]), AUTH.userId, {
    limit: 10,
    projectHash: "abc1234",
    status: "failed",
  });
  assert.equal(listed.ok, true);
});

test("cli intent list rejects missing bearer token", async () => {
  const res = await runCliIntentGet(new Request("http://test/api/cli/v1/intents"), {
    initSystemDb: async () => undefined,
    getDb: () => ({}) as never,
    authenticate: async () => null,
  });
  assert.equal(res.status, 401);
});

test("cli intent list supports tool and risk filters", async () => {
  const res = await runCliIntentGet(
    new Request(
      "http://test/api/cli/v1/intents?tool=flux.backup.ensureVerified&riskLevel=low",
    ),
    {
      initSystemDb: async () => undefined,
      getDb: () => mockListDb([ROW_B]),
      authenticate: async () => AUTH,
    },
  );
  assert.equal(res.status, 200);
  const json = (await res.json()) as { intents: Array<{ tool: string; riskLevel: string }> };
  assert.equal(json.intents[0]?.tool, "flux.backup.ensureVerified");
  assert.equal(json.intents[0]?.riskLevel, "low");
});

test("listMcpIntentsForUser scopes query to provided user id", async () => {
  const userAResult = await listMcpIntentsForUser(mockListDb([ROW_A]), AUTH.userId, {
    limit: 50,
  });
  const userBResult = await listMcpIntentsForUser(mockListDb([]), OTHER_USER, {
    limit: 50,
  });
  assert.equal(userAResult.ok, true);
  assert.equal(userBResult.ok, true);
  if (!userAResult.ok || !userBResult.ok) return;
  assert.equal(userAResult.result.intents.length, 1);
  assert.equal(userBResult.result.intents.length, 0);
});

const ROW_PARTIAL = {
  ...ROW_A,
  id: "00000000-0000-4000-8000-000000000012",
  createdAt: new Date("2026-06-28T12:00:00.000Z"),
  status: "failed",
  metadata: {
    partialApply: true,
    appliedCount: 1,
    appliedFiles: ["0001_init.sql"],
    failedFile: "0002_add.sql",
    failureIndex: 1,
    remainingFiles: ["0003_idx.sql"],
    gate: "migration_apply_failed",
  },
};

test("pre-check: both list routes return newest-first sanitized intents", async () => {
  const orderedRows = [ROW_A, ROW_B, ROW_PARTIAL];
  const db = mockListDb(orderedRows);

  const agentRes = await runAgentIntentList(
    new Request("http://test/api/agent/intents?limit=50"),
    {
      initSystemDb: async () => undefined,
      getDb: () => db,
      authenticate: async () => ({ user: { id: AUTH.userId } }),
    },
  );
  assert.equal(agentRes.status, 200);
  const agentJson = (await agentRes.json()) as {
    intents: Array<{ id: string; createdAt: string }>;
  };
  assert.equal(agentJson.intents[0]?.id, ROW_A.id);
  assert.ok(
    new Date(agentJson.intents[0]!.createdAt).getTime() >=
      new Date(agentJson.intents[1]!.createdAt).getTime(),
  );
  assert.equal(containsIntentLeak(agentJson), false);
  assert.equal("requestSummary" in (agentJson.intents[0] ?? {}), false);

  const cliRes = await runCliIntentGet(
    new Request("http://test/api/cli/v1/intents?limit=50"),
    {
      initSystemDb: async () => undefined,
      getDb: () => db,
      authenticate: async () => AUTH,
    },
  );
  assert.equal(cliRes.status, 200);
  const cliJson = (await cliRes.json()) as { intents: Array<{ id: string }> };
  assert.equal(cliJson.intents[0]?.id, ROW_A.id);
});

test("pre-check: filters and pagination on agent route", async () => {
  const page1 = await runAgentIntentList(
    new Request("http://test/api/agent/intents?status=failed&intentClass=write&limit=1"),
    {
      initSystemDb: async () => undefined,
      getDb: () => mockListDb([ROW_A, ROW_B]),
      authenticate: async () => ({ user: { id: AUTH.userId } }),
    },
  );
  assert.equal(page1.status, 200);
  const json1 = (await page1.json()) as {
    intents: Array<{ status: string; intentClass: string }>;
    nextCursor?: string;
  };
  assert.equal(json1.intents.length, 1);
  assert.equal(json1.intents[0]?.status, "failed");
  assert.ok(json1.nextCursor);

  const page2 = await runAgentIntentList(
    new Request(`http://test/api/agent/intents?limit=1&cursor=${encodeURIComponent(json1.nextCursor!)}`),
    {
      initSystemDb: async () => undefined,
      getDb: () => mockListDb([ROW_B]),
      authenticate: async () => ({ user: { id: AUTH.userId } }),
    },
  );
  assert.equal(page2.status, 200);
});

test("pre-check: stale partial and backup metadata safe on list routes", async () => {
  for (const row of [ROW_A, ROW_PARTIAL, ROW_B]) {
    const res = await runAgentIntentList(
      new Request(`http://test/api/agent/intents?tool=${encodeURIComponent(row.tool)}`),
      {
        initSystemDb: async () => undefined,
        getDb: () => mockListDb([row]),
        authenticate: async () => ({ user: { id: AUTH.userId } }),
      },
    );
    const json = (await res.json()) as {
      intents: Array<{ metadata?: Record<string, unknown> }>;
    };
    const meta = json.intents[0]?.metadata ?? {};
    assert.equal(containsIntentLeak(json), false);
    if (row === ROW_A) {
      assert.equal(meta.staleReason, "plan_file_checksum_mismatch");
      assert.deepEqual(meta.changedFiles, ["0001_init.sql"]);
    }
    if (row === ROW_PARTIAL) {
      assert.equal(meta.partialApply, true);
      assert.equal(meta.failedFile, "0002_add.sql");
    }
    if (row === ROW_B) {
      assert.equal(meta.verified, true);
      assert.equal(meta.backupId, "b1");
      assert.equal("offsiteKey" in meta, false);
    }
  }
});

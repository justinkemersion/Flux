import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAgentIntentsQuery,
  containsForbiddenAgentActivityDisplay,
  filtersToSearchParams,
  parseAgentActivityFilters,
  safeJsonPreview,
} from "../components/agent-activity/agent-activity-utils.ts";
import type { AgentActivityIntent } from "../components/agent-activity/agent-activity-types.ts";
import { containsIntentLeak } from "./mcp-intent-sanitize.ts";

const SAMPLE_INTENT: AgentActivityIntent = {
  id: "00000000-0000-4000-8000-000000000001",
  createdAt: "2026-06-30T12:00:00.000Z",
  updatedAt: "2026-06-30T12:00:01.000Z",
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
  summary: { hash: "abc1234", migrationsPath: "migrations" },
  metadata: {
    staleReason: "plan_file_checksum_mismatch",
    changedFiles: ["0001_init.sql"],
    gate: "migration_apply_blocked_stale_plan",
  },
};

const PARTIAL_INTENT: AgentActivityIntent = {
  ...SAMPLE_INTENT,
  id: "00000000-0000-4000-8000-000000000002",
  metadata: {
    partialApply: true,
    appliedCount: 1,
    appliedFiles: ["0001_init.sql"],
    failedFile: "0002_add.sql",
    gate: "migration_apply_failed",
  },
};

const BACKUP_INTENT: AgentActivityIntent = {
  ...SAMPLE_INTENT,
  id: "00000000-0000-4000-8000-000000000003",
  tool: "flux.backup.ensureVerified",
  intentClass: "protective_mutation",
  status: "completed",
  resultStatus: "ok",
  errorCode: null,
  metadata: {
    verified: true,
    backupId: "b1",
    trustTier: "restorable",
    detail: "restore-verified",
  },
};

test("buildAgentIntentsQuery encodes filters and pagination", () => {
  const url = buildAgentIntentsQuery(
    {
      projectHash: "abc1234",
      tool: "flux.migration.apply",
      status: "failed",
      intentClass: "write",
      riskLevel: "medium",
    },
    { limit: 25, cursor: "cursor-token" },
  );
  assert.match(url, /projectHash=abc1234/);
  assert.match(url, /tool=flux\.migration\.apply/);
  assert.match(url, /status=failed/);
  assert.match(url, /intentClass=write/);
  assert.match(url, /riskLevel=medium/);
  assert.match(url, /limit=25/);
  assert.match(url, /cursor=cursor-token/);
});

test("parseAgentActivityFilters round-trips through search params", () => {
  const filters = {
    projectHash: "abc1234",
    tool: "flux.migration.plan",
    status: "completed",
    intentClass: "plan",
    riskLevel: "low",
  };
  const params = filtersToSearchParams(filters);
  assert.deepEqual(parseAgentActivityFilters(params), filters);
});

test("agent activity display payload excludes forbidden fields", () => {
  const display = {
    intents: [SAMPLE_INTENT, PARTIAL_INTENT, BACKUP_INTENT],
    detail: {
      summary: SAMPLE_INTENT.summary,
      metadata: SAMPLE_INTENT.metadata,
    },
  };
  assert.equal(containsForbiddenAgentActivityDisplay(display), false);
  assert.equal(containsIntentLeak(display), false);
  assert.equal("requestSummary" in display.intents[0]!, false);
});

test("agent activity display rejects raw sql and paths in forbidden fixture", () => {
  const bad = {
    summary: { sql: "CREATE TABLE x (id int);" },
    workspaceRoot: "/tmp/repo",
    requestSummary: { hash: "abc1234" },
  };
  assert.equal(containsForbiddenAgentActivityDisplay(bad), true);
});

test("safeJsonPreview renders sanitized metadata for detail view", () => {
  const text = safeJsonPreview(SAMPLE_INTENT.metadata);
  assert.match(text, /staleReason/);
  assert.match(text, /0001_init\.sql/);
  assert.equal(text.includes("CREATE TABLE"), false);
});

test("empty agent activity list shape is safe", () => {
  const empty = { intents: [] as AgentActivityIntent[] };
  assert.equal(containsForbiddenAgentActivityDisplay(empty), false);
});

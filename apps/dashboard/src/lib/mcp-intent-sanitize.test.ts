import test from "node:test";
import assert from "node:assert/strict";
import {
  containsIntentLeak,
  sanitizeIntentMetadata,
  sanitizeIntentRequestSummary,
  sanitizeMcpIntentRow,
} from "./mcp-intent-sanitize.ts";

const BASE_ROW = {
  id: "00000000-0000-4000-8000-000000000001",
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
    planHash: "hash-1",
    migrationsPath: "migrations",
    sql: "CREATE TABLE secret (pw text);",
    workspaceRoot: "/tmp/flux-repo",
    token: "flx_live_0123456789abcdef0123456789abcdef_abcd",
  },
  metadata: {
    staleReason: "plan_file_checksum_mismatch",
    changedFiles: ["0001_init.sql"],
    gate: "migration_apply_blocked_stale_plan",
    password: "super-secret",
    primaryArtifactPath: "/srv/backups/x.dump",
  },
};

test("sanitizeIntentRequestSummary strips sql paths and tokens", () => {
  const summary = sanitizeIntentRequestSummary(BASE_ROW.requestSummary);
  assert.equal(summary.hash, "abc1234");
  assert.equal(summary.migrationsPath, "migrations");
  assert.equal("sql" in summary, false);
  assert.equal("workspaceRoot" in summary, false);
  assert.equal("token" in summary, false);
  assert.equal(containsIntentLeak(summary), false);
});

test("sanitizeIntentRequestSummary redacts absolute migrationsPath", () => {
  const summary = sanitizeIntentRequestSummary({
    hash: "abc1234",
    migrationsPath: "/home/user/app/migrations",
  });
  assert.equal(summary.migrationsPath, "[redacted]");
});

test("sanitizeIntentMetadata keeps migration apply stale fields safely", () => {
  const metadata = sanitizeIntentMetadata({
    staleReason: "plan_file_checksum_mismatch",
    changedFiles: ["0001_init.sql"],
    gate: "migration_apply_blocked_stale_plan",
    password: "nope",
    signedUrl: "https://signed.example/x",
  });
  assert.equal(metadata?.staleReason, "plan_file_checksum_mismatch");
  assert.deepEqual(metadata?.changedFiles, ["0001_init.sql"]);
  assert.equal(metadata?.gate, "migration_apply_blocked_stale_plan");
  assert.equal("password" in (metadata ?? {}), false);
  assert.equal("signedUrl" in (metadata ?? {}), false);
});

test("sanitizeIntentMetadata keeps partial apply fields safely", () => {
  const metadata = sanitizeIntentMetadata({
    partialApply: true,
    appliedCount: 1,
    appliedFiles: ["0001_init.sql"],
    failedFile: "0002_add.sql",
    failureIndex: 1,
    remainingFiles: ["0003_idx.sql"],
    destructiveShaped: false,
    backupTrustTier: "restorable",
    rawSql: "DROP TABLE users;",
  });
  assert.equal(metadata?.partialApply, true);
  assert.equal(metadata?.appliedCount, 1);
  assert.deepEqual(metadata?.appliedFiles, ["0001_init.sql"]);
  assert.equal(metadata?.failedFile, "0002_add.sql");
  assert.equal("rawSql" in (metadata ?? {}), false);
  assert.equal(containsIntentLeak(metadata), false);
});

test("sanitizeIntentMetadata keeps protective backup fields safely", () => {
  const metadata = sanitizeIntentMetadata({
    verified: true,
    created: false,
    backupId: "backup-1",
    trustTier: "restorable",
    detail: "restore-verified",
    offsiteBucket: "secret-bucket",
    primaryArtifactPath: "/srv/x",
  });
  assert.equal(metadata?.verified, true);
  assert.equal(metadata?.backupId, "backup-1");
  assert.equal(metadata?.trustTier, "restorable");
  assert.equal("offsiteBucket" in (metadata ?? {}), false);
  assert.equal("primaryArtifactPath" in (metadata ?? {}), false);
});

test("sanitizeMcpIntentRow never exposes raw requestSummary", () => {
  const sanitized = sanitizeMcpIntentRow(BASE_ROW);
  assert.equal("requestSummary" in sanitized, false);
  assert.ok(sanitized.summary);
  assert.equal(containsIntentLeak(sanitized), false);
});

test("sanitizeMcpIntentRow redacts postgres connection strings in summary values", () => {
  const sanitized = sanitizeMcpIntentRow({
    ...BASE_ROW,
    requestSummary: {
      hash: "abc1234",
      reason: "postgres://admin:secret@db.internal:5432/app",
    },
  });
  assert.equal(sanitized.summary.reason, "[redacted]");
});

test("sanitizeMcpIntentRow redacts JWT material", () => {
  const sanitized = sanitizeMcpIntentRow({
    ...BASE_ROW,
    requestSummary: {
      hash: "abc1234",
      reason:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abcdefghijklmnopqrstuvwxyz",
    },
  });
  assert.equal(sanitized.summary.reason, "[redacted]");
});

test("sanitizeIntentMetadata keeps safe MCP keyPreview", () => {
  const metadata = sanitizeIntentMetadata({
    authFamily: "mcp",
    keyType: "mcp",
    keyPreview: "flx_mcp_aabb…0123",
    embeddedKeyId: "aabbccddeeff",
  });
  assert.equal(metadata?.keyPreview, "flx_mcp_aabb…0123");
  assert.equal(metadata?.embeddedKeyId, "aabbccddeeff");
  assert.equal(containsIntentLeak(metadata), false);
});

test("sanitizeIntentRequestSummary redacts flx_mcp_ tokens in allowlisted fields", () => {
  const token = "flx_mcp_aabbccddeeff_0123456789abcdef0123_abcd";
  const summary = sanitizeIntentRequestSummary({
    hash: "abc1234",
    reason: `Bearer ${token}`,
  });
  assert.equal(summary.reason, "[redacted]");
  assert.equal(containsIntentLeak(summary), false);
});

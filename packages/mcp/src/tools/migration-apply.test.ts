import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationChecksum, type FluxMigrationRecord } from "@flux/core/sql-migrations";
import { buildMigrationPlan } from "./migration-plan";
import {
  runMigrationApply,
  validateStoredPlanForApply,
  buildApplyLoopFailureRemediation,
  buildApplyLoopFailureSummary,
  stalePlanRemediation,
  type MigrationApplyStaleReason,
} from "./migration-apply";
import { finalizeToolAudit } from "../audit-pipeline";
import { updateWriteIntentTerminal } from "../write-mutation";
import type { FluxToolClient } from "./index";
import type { UpdateMcpIntentInput } from "@flux/cli/api-client";
import { invokeFluxMcpTool } from "../server";
import { storeMigrationPlan } from "../plan-store";

const FILE_A = "0001_init.sql";
const FILE_B = "0002_add.sql";
const FILE_C = "0003_index.sql";
const SQL_A = "CREATE TABLE widgets (id uuid PRIMARY KEY);\n";
const SQL_B = "ALTER TABLE widgets ADD COLUMN name text;\n";
const SQL_C = "CREATE INDEX widgets_name_idx ON widgets (name);\n";
const SQL_DROP = "DROP TABLE widgets;\n";

const VERIFIED_BACKUP = {
  id: "backup-verified",
  format: "custom",
  status: "complete",
  artifactValidationStatus: "artifact_valid",
  restoreVerificationStatus: "restore_verified",
  createdAt: new Date().toISOString(),
};

function makeWorkspace(files: Record<string, string>): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "flux-mcp-apply-"));
  const dir = join(root, "migrations");
  mkdirSync(dir, { recursive: true });
  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(join(dir, name), sql);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function fakeClient(overrides: Partial<FluxToolClient> = {}): FluxToolClient {
  const base: FluxToolClient = {
    listProjects: async () => [],
    getProjectMetadata: async () => ({ slug: "demo", hash: "abc1234", mode: "v2_shared" }),
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
    fetchProjectActivity: async () => ({ projectSlug: "demo", hash: "abc1234", events: [] }),
    listProjectBackups: async () => ({ backups: [VERIFIED_BACKUP] }),
    createProjectBackup: async () => {
      throw new Error("unused");
    },
    verifyProjectBackup: async () => {
      throw new Error("unused");
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

function assertNoLeakage(value: unknown): void {
  const json = JSON.stringify(value);
  assert.equal(json.includes("/home/"), false);
  assert.equal(json.includes("/tmp/"), false);
  assert.equal(json.includes("CREATE TABLE"), false);
  assert.equal(json.includes("flx_live_"), false);
  assert.equal(json.includes("postgres://"), false);
}

function assertStaleResult(
  result: { ok: boolean; summary?: string; remediation?: string; data?: unknown },
  expectedReason: MigrationApplyStaleReason,
): void {
  assert.equal(result.ok, false);
  const data = result.data as {
    gate: string;
    staleReason: MigrationApplyStaleReason;
    planId: string;
    errorCode: string;
  };
  assert.equal(data.gate, "migration_apply_blocked_stale_plan");
  assert.equal(data.staleReason, expectedReason);
  assert.equal(data.errorCode, "invalid_input");
  assert.match(result.remediation ?? "", /flux\.migration\.plan/);
  assert.match(stalePlanRemediation(expectedReason), /flux\.migration\.plan/);
  assertNoLeakage(result);
}

test("validateStoredPlanForApply refuses missing plan", async () => {
  const ws = makeWorkspace({ [FILE_A]: SQL_A });
  try {
    const result = await validateStoredPlanForApply({
      hash: "abc1234",
      planId: "missing-plan",
      planHash: "deadbeef",
      workspaceRoot: ws.root,
      migrationsPath: "migrations",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stale.staleReason, "plan_not_found");
      assert.match(result.remediation, /MCP server restarted/i);
      assert.match(result.remediation, /Re-run flux\.migration\.plan/);
    }
  } finally {
    ws.cleanup();
  }
});

test("validateStoredPlanForApply refuses mismatched planHash", async () => {
  const ws = makeWorkspace({ [FILE_A]: SQL_A });
  try {
    const plan = await buildMigrationPlan(
      { hash: "abc1234", workspaceRoot: ws.root, migrationsPath: "migrations" },
      async () => [],
    );
    const result = await validateStoredPlanForApply({
      hash: "abc1234",
      planId: plan.planId,
      planHash: "wrong-hash",
      workspaceRoot: ws.root,
      migrationsPath: "migrations",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stale.staleReason, "plan_hash_mismatch");
      assert.equal(result.stale.expectedPlanHash, plan.planHash);
      assert.equal(result.stale.actualPlanHash, "wrong-hash");
      assert.match(result.remediation, /planHash does not match/i);
    }
  } finally {
    ws.cleanup();
  }
});

test("validateStoredPlanForApply refuses changed local file checksum", async () => {
  const ws = makeWorkspace({ [FILE_A]: SQL_A });
  try {
    const plan = await buildMigrationPlan(
      { hash: "abc1234", workspaceRoot: ws.root, migrationsPath: "migrations" },
      async () => [],
    );
    writeFileSync(join(ws.root, "migrations", FILE_A), "-- changed\n");
    const result = await validateStoredPlanForApply({
      hash: "abc1234",
      planId: plan.planId,
      planHash: plan.planHash,
      workspaceRoot: ws.root,
      migrationsPath: "migrations",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stale.staleReason, "plan_file_checksum_mismatch");
      assert.deepEqual(result.stale.changedFiles, [FILE_A]);
      assert.match(result.summary, /0001_init\.sql/);
      assert.match(result.remediation, /changed after planning/i);
    }
  } finally {
    ws.cleanup();
  }
});

test("validateStoredPlanForApply refuses missing local migration file", async () => {
  const ws = makeWorkspace({ [FILE_A]: SQL_A, [FILE_B]: SQL_B });
  try {
    const plan = await buildMigrationPlan(
      { hash: "abc1234", workspaceRoot: ws.root, migrationsPath: "migrations" },
      async () => [],
    );
    rmSync(join(ws.root, "migrations", FILE_B));
    const result = await validateStoredPlanForApply({
      hash: "abc1234",
      planId: plan.planId,
      planHash: plan.planHash,
      workspaceRoot: ws.root,
      migrationsPath: "migrations",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stale.staleReason, "plan_file_missing");
      assert.deepEqual(result.stale.missingFiles, [FILE_B]);
      assert.match(result.remediation, /missing locally/i);
    }
  } finally {
    ws.cleanup();
  }
});

test("validateStoredPlanForApply refuses invalid migrationsPath", async () => {
  const ws = makeWorkspace({ [FILE_A]: SQL_A });
  try {
    const plan = await buildMigrationPlan(
      { hash: "abc1234", workspaceRoot: ws.root, migrationsPath: "migrations" },
      async () => [],
    );
    const result = await validateStoredPlanForApply({
      hash: "abc1234",
      planId: plan.planId,
      planHash: plan.planHash,
      workspaceRoot: ws.root,
      migrationsPath: "no-such-dir",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stale.staleReason, "plan_migrations_path_invalid");
      assert.match(result.remediation, /migrationsPath/i);
    }
  } finally {
    ws.cleanup();
  }
});

test("validateStoredPlanForApply refuses plan with conflicts", async () => {
  const ws = makeWorkspace({ [FILE_A]: SQL_A });
  try {
    storeMigrationPlan({
      planId: "conflict-plan",
      planHash: "abc",
      hash: "abc1234",
      migrationsDir: join(ws.root, "migrations"),
      createdAt: new Date().toISOString(),
      apply: [],
      skip: [],
      conflicts: [
        {
          version: FILE_A,
          filename: FILE_A,
          checksum: migrationChecksum(SQL_A),
          appliedChecksum: "other",
        },
      ],
      destructiveShaped: false,
    });
    const result = await validateStoredPlanForApply({
      hash: "abc1234",
      planId: "conflict-plan",
      planHash: "abc",
      workspaceRoot: ws.root,
      migrationsPath: "migrations",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stale.staleReason, "plan_conflicts_present");
      assert.match(result.summary, /conflict/i);
      assert.match(result.remediation, /conflicts/i);
    }
  } finally {
    ws.cleanup();
  }
});

test("runMigrationApply refuses without restore-verified backup when required", async () => {
  const ws = makeWorkspace({ [FILE_A]: SQL_A });
  try {
    const plan = await buildMigrationPlan(
      { hash: "abc1234", workspaceRoot: ws.root, migrationsPath: "migrations" },
      async () => [],
    );
    const stored = (await validateStoredPlanForApply({
      hash: "abc1234",
      planId: plan.planId,
      planHash: plan.planHash,
      workspaceRoot: ws.root,
      migrationsPath: "migrations",
    })) as { ok: true; stored: import("../plan-store").StoredMigrationPlan; migrationsDir: string };

    const client = fakeClient({
      listProjectBackups: async () => ({
        backups: [
          {
            ...VERIFIED_BACKUP,
            restoreVerificationStatus: "not_verified",
          },
        ],
      }),
    });

    const res = await runMigrationApply(
      client,
      {
        hash: "abc1234",
        planId: plan.planId,
        planHash: plan.planHash,
        workspaceRoot: ws.root,
        migrationsPath: "migrations",
      },
      { intentId: "intent-1" },
      stored.stored,
      stored.migrationsDir,
    );
    assert.equal(res.ok, false);
    const data = res.data as { gate: string };
    assert.equal(data.gate, "migration_apply_blocked_no_backup");
    assert.match(res.remediation ?? "", /flux\.backup\.ensureVerified/);
  } finally {
    ws.cleanup();
  }
});

test("runMigrationApply refuses destructive-shaped plan unless allowDestructive", async () => {
  const ws = makeWorkspace({ [FILE_A]: SQL_A, "0002_drop.sql": SQL_DROP });
  try {
    const plan = await buildMigrationPlan(
      { hash: "abc1234", workspaceRoot: ws.root, migrationsPath: "migrations" },
      async () => [],
    );
    assert.equal(plan.destructiveShaped, true);
    const validated = await validateStoredPlanForApply({
      hash: "abc1234",
      planId: plan.planId,
      planHash: plan.planHash,
      workspaceRoot: ws.root,
      migrationsPath: "migrations",
    });
    assert.equal(validated.ok, true);

    const client = fakeClient();
    const res = await runMigrationApply(
      client,
      {
        hash: "abc1234",
        planId: plan.planId,
        planHash: plan.planHash,
        workspaceRoot: ws.root,
        migrationsPath: "migrations",
      },
      { intentId: "intent-1" },
      (validated as { ok: true; stored: import("../plan-store").StoredMigrationPlan }).stored,
      (validated as { ok: true; migrationsDir: string }).migrationsDir,
    );
    assert.equal(res.ok, false);
    const data = res.data as { gate: string };
    assert.equal(data.gate, "migration_apply_blocked_destructive_requires_allow");
  } finally {
    ws.cleanup();
  }
});

test("runMigrationApply allows non-destructive plan with restore-verified backup", async () => {
  const ws = makeWorkspace({ [FILE_A]: SQL_A, [FILE_B]: SQL_B });
  try {
    const plan = await buildMigrationPlan(
      { hash: "abc1234", workspaceRoot: ws.root, migrationsPath: "migrations" },
      async () => [],
    );
    const validated = await validateStoredPlanForApply({
      hash: "abc1234",
      planId: plan.planId,
      planHash: plan.planHash,
      workspaceRoot: ws.root,
      migrationsPath: "migrations",
    });
    assert.equal(validated.ok, true);

    const pushed: string[] = [];
    const client = fakeClient({
      pushSql: async (input) => {
        pushed.push(input.migration?.filename ?? "?");
        return { tablesMoved: 0, sequencesMoved: 0, viewsMoved: 0 };
      },
    });

    const res = await runMigrationApply(
      client,
      {
        hash: "abc1234",
        planId: plan.planId,
        planHash: plan.planHash,
        workspaceRoot: ws.root,
        migrationsPath: "migrations",
      },
      { intentId: "intent-1" },
      (validated as { ok: true; stored: import("../plan-store").StoredMigrationPlan }).stored,
      (validated as { ok: true; migrationsDir: string }).migrationsDir,
    );
    assert.equal(res.ok, true);
    assert.deepEqual(pushed, [FILE_A, FILE_B]);
    const data = res.data as { appliedCount: number; gate: string };
    assert.equal(data.appliedCount, 2);
    assert.equal(data.gate, "migration_apply_allowed");
  } finally {
    ws.cleanup();
  }
});

test("runMigrationApply stops on first failed file and returns partial metadata", async () => {
  const ws = makeWorkspace({ [FILE_A]: SQL_A, [FILE_B]: SQL_B, [FILE_C]: SQL_C });
  try {
    const plan = await buildMigrationPlan(
      { hash: "abc1234", workspaceRoot: ws.root, migrationsPath: "migrations" },
      async () => [],
    );
    const validated = await validateStoredPlanForApply({
      hash: "abc1234",
      planId: plan.planId,
      planHash: plan.planHash,
      workspaceRoot: ws.root,
      migrationsPath: "migrations",
    });
    assert.equal(validated.ok, true);

    let call = 0;
    const client = fakeClient({
      pushSql: async (input) => {
        call += 1;
        if (input.migration?.filename === FILE_B) {
          throw new Error("push rejected: CREATE TABLE secret (pw text);");
        }
        return { tablesMoved: 0, sequencesMoved: 0, viewsMoved: 0 };
      },
    });

    const res = await runMigrationApply(
      client,
      {
        hash: "abc1234",
        planId: plan.planId,
        planHash: plan.planHash,
        workspaceRoot: ws.root,
        migrationsPath: "migrations",
      },
      { intentId: "intent-1" },
      (validated as { ok: true; stored: import("../plan-store").StoredMigrationPlan }).stored,
      (validated as { ok: true; migrationsDir: string }).migrationsDir,
    );
    assert.equal(res.ok, false);
    assert.equal(call, 2);
    assert.match(res.summary ?? "", /Partial apply: 1 of 3/);
    assert.match(res.summary ?? "", /0002_add\.sql/);
    assert.equal(JSON.stringify(res).includes("CREATE TABLE"), false);
    const data = res.data as {
      appliedCount: number;
      appliedFiles: string[];
      failedFile: string;
      failureIndex: number;
      remainingFiles: string[];
      partialApply: boolean;
      gate: string;
      errorCode: string;
    };
    assert.equal(data.appliedCount, 1);
    assert.deepEqual(data.appliedFiles, [FILE_A]);
    assert.equal(data.failedFile, FILE_B);
    assert.equal(data.failureIndex, 1);
    assert.deepEqual(data.remainingFiles, [FILE_C]);
    assert.equal(data.partialApply, true);
    assert.equal(data.gate, "migration_apply_failed");
    assert.equal(data.errorCode, "upstream_error");
    assert.match(res.remediation ?? "", /ledger/i);
    assert.match(res.remediation ?? "", /Do not manually edit/i);
    assert.match(res.remediation ?? "", /0003_index\.sql/);
  } finally {
    ws.cleanup();
  }
});

test("runMigrationApply first file failure returns no applied files", async () => {
  const ws = makeWorkspace({ [FILE_A]: SQL_A, [FILE_B]: SQL_B });
  try {
    const plan = await buildMigrationPlan(
      { hash: "abc1234", workspaceRoot: ws.root, migrationsPath: "migrations" },
      async () => [],
    );
    const validated = await validateStoredPlanForApply({
      hash: "abc1234",
      planId: plan.planId,
      planHash: plan.planHash,
      workspaceRoot: ws.root,
      migrationsPath: "migrations",
    });
    assert.equal(validated.ok, true);

    const client = fakeClient({
      pushSql: async () => {
        throw new Error("syntax error at CREATE TABLE");
      },
    });

    const res = await runMigrationApply(
      client,
      {
        hash: "abc1234",
        planId: plan.planId,
        planHash: plan.planHash,
        workspaceRoot: ws.root,
        migrationsPath: "migrations",
      },
      { intentId: "intent-1" },
      (validated as { ok: true; stored: import("../plan-store").StoredMigrationPlan }).stored,
      (validated as { ok: true; migrationsDir: string }).migrationsDir,
    );
    assert.equal(res.ok, false);
    assert.match(res.summary ?? "", /no migrations from this apply call were recorded/i);
    const data = res.data as {
      appliedCount: number;
      appliedFiles: string[];
      failedFile: string;
      failureIndex: number;
      remainingFiles: string[];
      partialApply: boolean;
    };
    assert.equal(data.appliedCount, 0);
    assert.deepEqual(data.appliedFiles, []);
    assert.equal(data.failedFile, FILE_A);
    assert.equal(data.failureIndex, 0);
    assert.deepEqual(data.remainingFiles, [FILE_B]);
    assert.equal(data.partialApply, false);
    assert.match(res.remediation ?? "", /No migrations from this MCP apply call/i);
    assert.match(res.remediation ?? "", /Do not manually edit/i);
  } finally {
    ws.cleanup();
  }
});

test("buildApplyLoopFailureSummary and remediation cover partial and full failure", () => {
  assert.match(
    buildApplyLoopFailureSummary({
      appliedCount: 2,
      totalPlanned: 4,
      failedFile: "0003_x.sql",
      failureIndex: 2,
    }),
    /Partial apply: 2 of 4/,
  );
  assert.match(
    buildApplyLoopFailureSummary({
      appliedCount: 0,
      totalPlanned: 2,
      failedFile: "0001_x.sql",
      failureIndex: 0,
    }),
    /no migrations from this apply call were recorded/,
  );
  assert.match(
    buildApplyLoopFailureRemediation({
      appliedCount: 1,
      failedFile: "0002_x.sql",
      remainingFiles: ["0003_y.sql"],
    }),
    /Do not manually edit or delete migration ledger rows/,
  );
});

test("invokeFluxMcpTool partial failure updates intent with safe metadata", async () => {
  const ws = makeWorkspace({ [FILE_A]: SQL_A, [FILE_B]: SQL_B });
  try {
    const plan = await buildMigrationPlan(
      { hash: "abc1234", workspaceRoot: ws.root, migrationsPath: "migrations" },
      async () => [],
    );
    const captured: { patch?: UpdateMcpIntentInput } = {};
    const client = fakeClient({
      pushSql: async (input) => {
        if (input.migration?.filename === FILE_B) {
          throw new Error("failed");
        }
        return { tablesMoved: 0, sequencesMoved: 0, viewsMoved: 0 };
      },
      updateMcpIntent: async (_id, patch) => {
        captured.patch = patch;
        return { intentId: "intent-1", status: patch.status ?? "failed" };
      },
    });
    const res = await invokeFluxMcpTool(
      "flux.migration.apply",
      {
        hash: "abc1234",
        planId: plan.planId,
        planHash: plan.planHash,
        workspaceRoot: ws.root,
        migrationsPath: "migrations",
      },
      client,
    );
    assert.equal(res.ok, false);
    assert.equal(captured.patch?.status, "failed");
    const metadata = captured.patch?.metadata as Record<string, unknown>;
    assert.deepEqual(metadata.appliedFiles, [FILE_A]);
    assert.equal(metadata.failedFile, FILE_B);
    assert.deepEqual(metadata.remainingFiles, []);
    assert.equal(metadata.partialApply, true);
    assert.equal(JSON.stringify(metadata).includes("CREATE"), false);
  } finally {
    ws.cleanup();
  }
});

test("updateWriteIntentTerminal stores partial failure metadata without sql", async () => {
  const client = fakeClient({
    updateMcpIntent: async () => ({ intentId: "intent-1", status: "failed" }),
  });
  const result = {
    ok: false as const,
    summary: "partial",
    data: {
      planId: "p1",
      planHash: "h1",
      appliedCount: 1,
      appliedFiles: [FILE_A],
      failedFile: FILE_B,
      failureIndex: 1,
      remainingFiles: [FILE_C],
      partialApply: true,
      destructiveShaped: false,
      intentId: "intent-1",
      gate: "migration_apply_failed" as const,
      errorCode: "upstream_error",
      backupTrustTier: "restorable" as const,
    },
    remediation: "fix",
  };
  let patch: UpdateMcpIntentInput | undefined;
  await updateWriteIntentTerminal(
    {
      ...client,
      updateMcpIntent: async (
        _id: string,
        input: UpdateMcpIntentInput,
      ): Promise<{ intentId: string; status: string }> => {
        patch = input;
        return { intentId: "intent-1", status: "failed" };
      },
    },
    "intent-1",
    result,
    "upstream_error",
  );
  assert.equal(patch?.status, "failed");
  const metadata = patch?.metadata as Record<string, unknown> | null | undefined;
  const remaining = metadata?.remainingFiles as string[] | undefined;
  assert.equal(remaining?.[0], FILE_C);
  assert.equal(metadata?.partialApply, true);
});

test("finalizeToolAudit migration apply partial failure includes safe audit metadata", async () => {
  const audits: unknown[] = [];
  await finalizeToolAudit({
    event: {
      tool: "flux.migration.apply",
      intentClass: "write",
      decision: "allow",
      status: "error",
      durationMs: 9,
      args: { hash: "abc1234", planId: "plan-1", planHash: "hash-1", migrationsPath: "migrations" },
      skipIntentCreate: true,
      gate: "migration_apply_failed",
      intentId: "intent-42",
      errorCode: "upstream_error",
    },
    args: { hash: "abc1234", planId: "plan-1", planHash: "hash-1", migrationsPath: "migrations" },
    result: {
      ok: false,
      summary: "Partial apply: 1 of 2 migration(s) applied; failed on 0002_add.sql (file 2 of 2).",
      remediation: "Do not manually edit",
      data: {
        planId: "plan-1",
        planHash: "hash-1",
        appliedCount: 1,
        appliedFiles: ["0001_init.sql"],
        failedFile: "0002_add.sql",
        failureIndex: 1,
        remainingFiles: [],
        partialApply: true,
        destructiveShaped: false,
        intentId: "intent-42",
        gate: "migration_apply_failed",
        errorCode: "upstream_error",
        backupTrustTier: "restorable",
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
  const audit = audits[0] as {
    gate?: string;
    resultStatus?: string;
    metadata?: Record<string, unknown>;
  };
  assert.equal(audit.gate, "migration_apply_failed");
  assert.equal(audit.resultStatus, "error");
  assert.deepEqual(audit.metadata?.appliedFiles, ["0001_init.sql"]);
  assert.equal(audit.metadata?.failedFile, "0002_add.sql");
  assert.equal(audit.metadata?.partialApply, true);
  assert.equal(JSON.stringify(audit).includes("CREATE TABLE"), false);
});

test("invokeFluxMcpTool apply refuses when persisted audit unavailable", async () => {
  const ws = makeWorkspace({ [FILE_A]: SQL_A });
  try {
    const plan = await buildMigrationPlan(
      { hash: "abc1234", workspaceRoot: ws.root, migrationsPath: "migrations" },
      async () => [],
    );
    const client = fakeClient({
      recordMcpAuditEvent: undefined as never,
      createMcpIntent: undefined as never,
      updateMcpIntent: undefined as never,
    });
    const res = await invokeFluxMcpTool(
      "flux.migration.apply",
      {
        hash: "abc1234",
        planId: plan.planId,
        planHash: plan.planHash,
        workspaceRoot: ws.root,
        migrationsPath: "migrations",
      },
      client,
    );
    assert.equal(res.ok, false);
    assert.match(res.summary, /persistence is unavailable/i);
  } finally {
    ws.cleanup();
  }
});

test("invokeFluxMcpTool apply refuses when intent creation fails", async () => {
  const ws = makeWorkspace({ [FILE_A]: SQL_A });
  try {
    const plan = await buildMigrationPlan(
      { hash: "abc1234", workspaceRoot: ws.root, migrationsPath: "migrations" },
      async () => [],
    );
    const client = fakeClient({
      createMcpIntent: async () => {
        throw new Error("intent store down");
      },
    });
    const res = await invokeFluxMcpTool(
      "flux.migration.apply",
      {
        hash: "abc1234",
        planId: plan.planId,
        planHash: plan.planHash,
        workspaceRoot: ws.root,
        migrationsPath: "migrations",
      },
      client,
    );
    assert.equal(res.ok, false);
    assert.match(res.summary, /intent required/i);
  } finally {
    ws.cleanup();
  }
});

test("invokeFluxMcpTool apply stale plan returns typed refusal before intent", async () => {
  const ws = makeWorkspace({ [FILE_A]: SQL_A });
  try {
    const plan = await buildMigrationPlan(
      { hash: "abc1234", workspaceRoot: ws.root, migrationsPath: "migrations" },
      async () => [],
    );
    writeFileSync(join(ws.root, "migrations", FILE_A), "-- drift\n");
    let intentCreated = false;
    const client = fakeClient({
      createMcpIntent: async () => {
        intentCreated = true;
        return { intentId: "intent-1", status: "pending" };
      },
    });
    const res = await invokeFluxMcpTool(
      "flux.migration.apply",
      {
        hash: "abc1234",
        planId: plan.planId,
        planHash: plan.planHash,
        workspaceRoot: ws.root,
        migrationsPath: "migrations",
      },
      client,
    );
    assert.equal(intentCreated, false);
    assertStaleResult(res, "plan_file_checksum_mismatch");
    const data = res.data as { changedFiles?: string[]; planId: string; planHash: string };
    assert.equal(data.planId, plan.planId);
    assert.equal(data.planHash, plan.planHash);
    assert.deepEqual(data.changedFiles, [FILE_A]);
  } finally {
    ws.cleanup();
  }
});

test("runMigrationApply ledger drift after intent returns stale metadata with intentId", async () => {
  const ws = makeWorkspace({ [FILE_A]: SQL_A });
  try {
    const plan = await buildMigrationPlan(
      { hash: "abc1234", workspaceRoot: ws.root, migrationsPath: "migrations" },
      async () => [],
    );
    const validated = await validateStoredPlanForApply({
      hash: "abc1234",
      planId: plan.planId,
      planHash: plan.planHash,
      workspaceRoot: ws.root,
      migrationsPath: "migrations",
    });
    assert.equal(validated.ok, true);

    const appliedRecord: FluxMigrationRecord = {
      version: FILE_A,
      filename: FILE_A,
      checksum: migrationChecksum(SQL_A),
      appliedAt: new Date().toISOString(),
    };
    const client = fakeClient({
      listAppliedMigrations: async () => [appliedRecord],
    });

    const res = await runMigrationApply(
      client,
      {
        hash: "abc1234",
        planId: plan.planId,
        planHash: plan.planHash,
        workspaceRoot: ws.root,
        migrationsPath: "migrations",
      },
      { intentId: "intent-stale" },
      (validated as { ok: true; stored: import("../plan-store").StoredMigrationPlan }).stored,
      (validated as { ok: true; migrationsDir: string }).migrationsDir,
    );
    assertStaleResult(res, "plan_apply_set_changed");
    const data = res.data as { intentId?: string; expectedPlanHash?: string; actualPlanHash?: string };
    assert.equal(data.intentId, "intent-stale");
    assert.equal(data.expectedPlanHash, plan.planHash);
    assert.ok(typeof data.actualPlanHash === "string" && data.actualPlanHash.length > 0);
  } finally {
    ws.cleanup();
  }
});

test("updateWriteIntentTerminal stores stale refusal metadata without sql or paths", async () => {
  const client = fakeClient({
    updateMcpIntent: async () => ({ intentId: "intent-1", status: "failed" }),
  });
  const result = {
    ok: false as const,
    summary: "stale",
    data: {
      planId: "p1",
      planHash: "h1",
      appliedCount: 0 as const,
      appliedFiles: [] as [],
      gate: "migration_apply_blocked_stale_plan" as const,
      staleReason: "plan_file_checksum_mismatch" as const,
      changedFiles: [FILE_A],
      errorCode: "invalid_input" as const,
      intentId: "intent-1",
    },
    remediation: stalePlanRemediation("plan_file_checksum_mismatch"),
  };
  let patch: UpdateMcpIntentInput | undefined;
  await updateWriteIntentTerminal(
    {
      ...client,
      updateMcpIntent: async (
        _id: string,
        input: UpdateMcpIntentInput,
      ): Promise<{ intentId: string; status: string }> => {
        patch = input;
        return { intentId: "intent-1", status: "failed" };
      },
    },
    "intent-1",
    result,
    "invalid_input",
  );
  assert.equal(patch?.status, "failed");
  const metadata = patch?.metadata as Record<string, unknown> | null | undefined;
  assert.equal(metadata?.staleReason, "plan_file_checksum_mismatch");
  assert.deepEqual(metadata?.changedFiles, [FILE_A]);
  assert.equal(metadata?.gate, "migration_apply_blocked_stale_plan");
  assertNoLeakage(metadata);
});

test("finalizeToolAudit migration apply stale plan includes safe audit metadata", async () => {
  const audits: unknown[] = [];
  await finalizeToolAudit({
    event: {
      tool: "flux.migration.apply",
      intentClass: "write",
      decision: "allow",
      status: "error",
      durationMs: 5,
      args: { hash: "abc1234", planId: "plan-1", planHash: "hash-1", migrationsPath: "migrations" },
      skipIntentCreate: true,
      gate: "migration_apply_blocked_stale_plan",
      errorCode: "invalid_input",
    },
    args: { hash: "abc1234", planId: "plan-1", planHash: "hash-1", migrationsPath: "migrations" },
    result: {
      ok: false,
      summary: "Local migration changed since planning: 0001_init.sql.",
      remediation: stalePlanRemediation("plan_file_checksum_mismatch"),
      data: {
        planId: "plan-1",
        planHash: "hash-1",
        appliedCount: 0,
        appliedFiles: [],
        gate: "migration_apply_blocked_stale_plan",
        staleReason: "plan_file_checksum_mismatch",
        changedFiles: ["0001_init.sql"],
        errorCode: "invalid_input",
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
  const audit = audits[0] as {
    gate?: string;
    resultStatus?: string;
    metadata?: Record<string, unknown>;
  };
  assert.equal(audit.gate, "migration_apply_blocked_stale_plan");
  assert.equal(audit.resultStatus, "error");
  assert.equal(audit.metadata?.staleReason, "plan_file_checksum_mismatch");
  assert.deepEqual(audit.metadata?.changedFiles, ["0001_init.sql"]);
  assertNoLeakage(audit);
});

test("invokeFluxMcpTool intent updates completed on success", async () => {
  const ws = makeWorkspace({ [FILE_A]: SQL_A });
  try {
    const plan = await buildMigrationPlan(
      { hash: "abc1234", workspaceRoot: ws.root, migrationsPath: "migrations" },
      async () => [],
    );
    const captured: { patch?: UpdateMcpIntentInput } = {};
    const client = fakeClient({
      updateMcpIntent: async (_id, patch) => {
        captured.patch = patch;
        return { intentId: "intent-1", status: patch.status ?? "completed" };
      },
    });
    const res = await invokeFluxMcpTool(
      "flux.migration.apply",
      {
        hash: "abc1234",
        planId: plan.planId,
        planHash: plan.planHash,
        workspaceRoot: ws.root,
        migrationsPath: "migrations",
      },
      client,
    );
    assert.equal(res.ok, true);
    assert.equal(captured.patch?.status, "completed");
  } finally {
    ws.cleanup();
  }
});

test("invokeFluxMcpTool intent updates failed on refusal", async () => {
  const ws = makeWorkspace({ [FILE_A]: SQL_A });
  try {
    const plan = await buildMigrationPlan(
      { hash: "abc1234", workspaceRoot: ws.root, migrationsPath: "migrations" },
      async () => [],
    );
    const captured: { patch?: UpdateMcpIntentInput } = {};
    const client = fakeClient({
      listProjectBackups: async () => ({ backups: [] }),
      updateMcpIntent: async (_id, patch) => {
        captured.patch = patch;
        return { intentId: "intent-1", status: patch.status ?? "failed" };
      },
    });
    const res = await invokeFluxMcpTool(
      "flux.migration.apply",
      {
        hash: "abc1234",
        planId: plan.planId,
        planHash: plan.planHash,
        workspaceRoot: ws.root,
        migrationsPath: "migrations",
      },
      client,
    );
    assert.equal(res.ok, false);
    assert.equal(captured.patch?.status, "failed");
  } finally {
    ws.cleanup();
  }
});

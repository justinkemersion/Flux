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
} from "./migration-apply";
import type { FluxToolClient } from "./index";
import type { UpdateMcpIntentInput } from "@flux/cli/api-client";
import { invokeFluxMcpTool } from "../server";
import { storeMigrationPlan } from "../plan-store";

const FILE_A = "0001_init.sql";
const FILE_B = "0002_add.sql";
const SQL_A = "CREATE TABLE widgets (id uuid PRIMARY KEY);\n";
const SQL_B = "ALTER TABLE widgets ADD COLUMN name text;\n";
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
      assert.equal(result.gate, "migration_apply_blocked_stale_plan");
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
      assert.match(result.summary, /drift/i);
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
      assert.match(result.summary, /conflict/i);
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

    let call = 0;
    const client = fakeClient({
      pushSql: async (input) => {
        call += 1;
        if (input.migration?.filename === FILE_B) {
          throw new Error("push rejected");
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
    const data = res.data as {
      appliedCount: number;
      appliedFiles: string[];
      failedFile: string;
      gate: string;
    };
    assert.equal(data.appliedCount, 1);
    assert.deepEqual(data.appliedFiles, [FILE_A]);
    assert.equal(data.failedFile, FILE_B);
    assert.equal(data.gate, "migration_apply_failed");
  } finally {
    ws.cleanup();
  }
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

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTools,
  type FluxToolClient,
  type ToolDeps,
  type ToolDef,
} from "./index";
import type {
  DatabaseAccessPlan,
  TemporaryDbCredential,
} from "@flux/cli/api-client";
import { containsBackupStorageLeak } from "./backup-sanitize";

const FAKE_V2_PLAN = { mode: "v2_shared" } as unknown as DatabaseAccessPlan;

const RO_CREDENTIAL: TemporaryDbCredential = {
  username: "flux_temp_ro_abc1234_deadbeef",
  password: "super-secret-temp-password",
  access: "readonly",
  expiresAt: "2026-01-01T00:15:00.000Z",
  tenantSchema: "t_abc123456789_api",
  searchPath: ["t_abc123456789_api"],
};

function fakeClient(overrides: Partial<FluxToolClient>): FluxToolClient {
  const base: FluxToolClient = {
    listProjects: async () => [],
    getProjectMetadata: async () => ({ slug: "s", hash: "h", mode: "v2_shared" }),
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
    fetchProjectActivity: async () => ({ projectSlug: "s", hash: "h", events: [] }),
    listProjectBackups: async () => ({ backups: [] }),
    getProjectDbAccessPlan: async () => FAKE_V2_PLAN,
    createTemporaryProjectDbCredential: async () => RO_CREDENTIAL,
    recordMcpAuditEvent: async () => ({ ok: true, auditId: "audit-1" }),
    createMcpIntent: async () => ({ intentId: "intent-1", status: "completed" }),
    updateMcpIntent: async () => ({ intentId: "intent-1", status: "completed" }),
    createProjectBackup: async () => ({
      backup: { id: "b-new", format: "custom", status: "complete" },
    }),
    verifyProjectBackup: async () => ({
      ok: true,
      backupId: "b-new",
      restoreVerificationStatus: "restore_verified",
    }),
    pushSql: async () => ({ tablesMoved: 0, sequencesMoved: 0, viewsMoved: 0 }),
  };
  return { ...base, ...overrides };
}

function getTool(
  client: FluxToolClient,
  name: string,
  deps: ToolDeps = {},
): ToolDef {
  const def = buildTools(client, deps).find((d) => d.name === name);
  assert.ok(def, `tool ${name} should exist`);
  return def;
}

test("destructive.preflight blocks when there are no backups", async () => {
  const tool = getTool(
    fakeClient({ listProjectBackups: async () => ({ backups: [] }) }),
    "flux.destructive.preflight",
  );
  const res = await tool.handler({ hash: "abc1234" });
  assert.equal(res.ok, true);
  const data = res.data as { allowed: boolean; tier: string };
  assert.equal(data.allowed, false);
  assert.equal(data.tier, "no_backups");
  assert.ok(res.remediation);
});

test("destructive.preflight allows when latest backup is restore-verified", async () => {
  const tool = getTool(
    fakeClient({
      listProjectBackups: async () => ({
        backups: [
          {
            id: "b1",
            format: "custom",
            status: "complete",
            artifactValidationStatus: "artifact_valid",
            restoreVerificationStatus: "restore_verified",
          },
        ],
      }),
    }),
    "flux.destructive.preflight",
  );
  const res = await tool.handler({ hash: "abc1234" });
  assert.equal(res.ok, true);
  const data = res.data as { allowed: boolean; tier: string };
  assert.equal(data.allowed, true);
  assert.equal(data.tier, "restorable");
  assert.equal(res.remediation, undefined);
});

test("backup.list returns sanitized backup rows without storage fields", async () => {
  const tool = getTool(
    fakeClient({
      listProjectBackups: async () => ({
        backups: [
          {
            id: "b1",
            kind: "tenant_export",
            format: "pg_custom",
            status: "complete",
            createdAt: "2026-06-27T15:31:45.367Z",
            completedAt: "2026-06-27T15:31:50.000Z",
            sizeBytes: 999,
            checksumSha256: "deadbeef",
            primaryArtifactAbsolutePath: "/srv/flux/backups/b1.dump",
            offsiteKey: "tenant/b1.dump",
            offsiteBucket: "flux-backups",
            artifactValidationStatus: "artifact_valid",
            restoreVerificationStatus: "restore_verified",
          },
        ],
        backupVolumeAbsoluteRoot: "/srv/flux/backups",
        platformMinimumBackupFreshness: {
          effectivePolicy: { intervalDays: 7, retentionCount: 4, retentionDays: 30 },
          freshness: { tier: "fresh", platformBackupCompliant: true, detail: "ok" },
        },
      }),
    }),
    "flux.backup.list",
  );
  const res = await tool.handler({ hash: "abc1234" });
  assert.equal(res.ok, true);
  assert.equal(containsBackupStorageLeak(res.data), false);
  const data = res.data as {
    backups: { backupId: string; trustTier: string; restoreVerified?: boolean }[];
    platformBackupCompliant?: boolean;
  };
  assert.equal(data.backups[0]!.backupId, "b1");
  assert.equal(data.backups[0]!.trustTier, "restorable");
  assert.equal(data.backups[0]!.restoreVerified, true);
  assert.equal(data.platformBackupCompliant, true);
});

test("read tools reject a missing hash argument", async () => {
  const tool = getTool(fakeClient({}), "flux.doctor");
  await assert.rejects(() => tool.handler({}), /hash/);
});

const LIFECYCLE_AT_LIMIT = {
  slug: "s",
  hash: "h",
  name: "s",
  lifecycleState: "active" as const,
  summary: "ok",
  activeCount: 3,
  activeLimit: 10,
  plan: "pro" as const,
};

test("project.describe warns when no FLUX.md brief is synced", async () => {
  const tool = getTool(
    fakeClient({
      getProjectMetadata: async () => ({ slug: "s", hash: "h", mode: "v2_shared" }),
      getProjectLifecycleState: async () => LIFECYCLE_AT_LIMIT,
      fetchProjectFluxMdDetail: async () => ({
        slug: "s",
        hash: "h",
        name: "s",
        content: null,
        syncedAt: null,
      }),
    }),
    "flux.project.describe",
  );
  const res = await tool.handler({ hash: "abc1234" });
  assert.equal(res.ok, true);
  const warnings = (res.data as { warnings: Array<{ code: string }> }).warnings;
  assert.ok(warnings.some((w) => w.code === "agent_context_missing"));
  assert.equal(
    warnings.some((w) => w.code === "plan_limit_exceeded"),
    false,
  );
});

test("project.describe warns when activeCount exceeds activeLimit", async () => {
  const tool = getTool(
    fakeClient({
      getProjectMetadata: async () => ({
        slug: "s",
        hash: "h",
        mode: "v2_shared",
        brief: "synced brief",
      }),
      getProjectLifecycleState: async () => ({
        ...LIFECYCLE_AT_LIMIT,
        activeCount: 13,
        activeLimit: 10,
      }),
      fetchProjectFluxMdDetail: async () => ({
        slug: "s",
        hash: "h",
        name: "s",
        content: "# brief",
        syncedAt: "2026-01-01T00:00:00.000Z",
      }),
    }),
    "flux.project.describe",
  );
  const res = await tool.handler({ hash: "abc1234" });
  assert.equal(res.ok, true);
  const warnings = (res.data as { warnings: Array<{ code: string }> }).warnings;
  assert.ok(warnings.some((w) => w.code === "plan_limit_exceeded"));
  assert.equal(
    warnings.some((w) => w.code === "agent_context_missing"),
    false,
  );
});

test("project.list returns a count and the project array", async () => {
  const tool = getTool(
    fakeClient({
      listProjects: async () => [
        {
          slug: "a",
          hash: "h",
          status: "running",
          apiUrl: "https://example",
          lifecycleState: "active",
        },
      ],
    }),
    "flux.project.list",
  );
  const res = await tool.handler({});
  assert.equal(res.ok, true);
  const data = res.data as { projects: unknown[] };
  assert.equal(data.projects.length, 1);
});

test("credentials.temporary refuses non-ro access", async () => {
  const tool = getTool(fakeClient({}), "flux.credentials.temporary");
  await assert.rejects(
    () => tool.handler({ hash: "abc1234", access: "rw" }),
    /access must be "ro"/,
  );
});

test("credentials.temporary rejects v1_dedicated projects", async () => {
  const tool = getTool(
    fakeClient({
      getProjectMetadata: async () => ({ slug: "s", hash: "h", mode: "v1_dedicated" }),
    }),
    "flux.credentials.temporary",
  );
  await assert.rejects(
    () => tool.handler({ hash: "abc1234" }),
    /only available for v2_shared/,
  );
});

test("credentials.temporary forces readonly and returns the credential", async () => {
  let requestedAccess: string | undefined;
  const tool = getTool(
    fakeClient({
      createTemporaryProjectDbCredential: async (_hash, options) => {
        requestedAccess = options?.access;
        return RO_CREDENTIAL;
      },
    }),
    "flux.credentials.temporary",
  );
  const res = await tool.handler({ hash: "abc1234" });
  assert.equal(res.ok, true);
  assert.equal(requestedAccess, "readonly");
  const data = res.data as { credential: { access: string } };
  assert.equal(data.credential.access, "readonly");
});

const okExecutor: ToolDeps = {
  queryExecutor: {
    run: async (req) => {
      // Echo back the wrapped SQL so the test can assert LIMIT enforcement.
      return { rows: [{ wrapped: req.wrappedSql }], fields: ["wrapped"] };
    },
  },
};

test("query.readonly rejects mutation SQL before any DB access", async () => {
  let executed = false;
  let credentialIssued = false;
  const tool = getTool(
    fakeClient({
      createTemporaryProjectDbCredential: async () => {
        credentialIssued = true;
        return RO_CREDENTIAL;
      },
    }),
    "flux.query.readonly",
    {
      queryExecutor: {
        run: async () => {
          executed = true;
          return { rows: [], fields: [] };
        },
      },
    },
  );
  await assert.rejects(
    () =>
      tool.handler({
        hash: "abc1234",
        sql: "WITH x AS (DELETE FROM products RETURNING *) SELECT * FROM x",
      }),
    /non-read or privileged/,
  );
  assert.equal(executed, false);
  assert.equal(credentialIssued, false);
});

test("query.readonly wraps SELECT with a bounded LIMIT and reports rows", async () => {
  const tool = getTool(fakeClient({}), "flux.query.readonly", okExecutor);
  const res = await tool.handler({
    hash: "abc1234",
    sql: "SELECT id FROM products",
    rowCap: 25,
  });
  assert.equal(res.ok, true);
  const data = res.data as {
    rows: Array<{ wrapped: string }>;
    rowCount: number;
    rowCap: number;
  };
  assert.equal(data.rowCap, 25);
  // cap + 1 is requested so truncation can be detected.
  assert.match(data.rows[0]!.wrapped, /LIMIT 26$/);
  assert.match(data.rows[0]!.wrapped, /flux_readonly/);
});

test("query.readonly truncates at the row cap", async () => {
  const manyRows: ToolDeps = {
    queryExecutor: {
      run: async () => ({
        rows: [{ n: 1 }, { n: 2 }, { n: 3 }],
        fields: ["n"],
      }),
    },
  };
  const tool = getTool(fakeClient({}), "flux.query.readonly", manyRows);
  const res = await tool.handler({
    hash: "abc1234",
    sql: "SELECT n FROM t",
    rowCap: 2,
  });
  const data = res.data as { rows: unknown[]; truncated: boolean; rowCount: number };
  assert.equal(data.truncated, true);
  assert.equal(data.rows.length, 2);
  assert.equal(data.rowCount, 2);
});

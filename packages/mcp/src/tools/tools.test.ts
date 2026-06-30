import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTools, type FluxToolClient, type ToolDef } from "./index";

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
  };
  return { ...base, ...overrides };
}

function getTool(client: FluxToolClient, name: string): ToolDef {
  const def = buildTools(client).find((d) => d.name === name);
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

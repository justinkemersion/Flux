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

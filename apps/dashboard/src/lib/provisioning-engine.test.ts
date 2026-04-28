import test from "node:test";
import assert from "node:assert/strict";
import type { ProjectManager } from "@flux/core";
import { dispatchProvisionProject } from "./provisioning-engine";

test("dispatchProvisionProject routes v1_dedicated through ProjectManager", async () => {
  let called = false;
  const projectManager = {
    provisionProject: async () => {
      called = true;
      return {
        name: "My App",
        slug: "my-app",
        hash: "abc1234",
        apiUrl: "https://api.my-app.abc1234.localhost",
        stripSupabaseRestPrefix: true,
        jwtSecret: "jwt",
        postgresPassword: "pw",
        postgres: { containerName: "db-container" },
      };
    },
    nukeContainersOnly: async () => undefined,
  } as unknown as ProjectManager;

  const result = await dispatchProvisionProject({
    mode: "v1_dedicated",
    projectName: "My App",
    projectHash: "abc1234",
    tenantId: "550e8400-e29b-41d4-a716-446655440000",
    projectManager,
    isProduction: false,
  });

  assert.equal(called, true);
  assert.equal(result.mode, "v1_dedicated");
  assert.equal(result.slug, "my-app");
  assert.equal(result.hash, "abc1234");
  assert.equal(result.secrets.postgresContainerHost, "db-container");
});

test("dispatchProvisionProject routes v2_shared through engine-v2 provisioner", async () => {
  const projectManager = {} as ProjectManager;
  const called: string[] = [];
  const result = await dispatchProvisionProject({
    mode: "v2_shared",
    projectName: "My Shared App",
    projectHash: "def5678",
    tenantId: "550e8400-e29b-41d4-a716-446655440000",
    projectManager,
    isProduction: false,
    provisionSharedTenant: async (tenantId) => {
      called.push(tenantId);
      return {
        tenantId,
        shortId: "550e8400e29b",
        schema: "t_550e8400e29b_api",
        role: "t_550e8400e29b_role",
      };
    },
  });

  assert.equal(called.length, 1);
  assert.equal(called[0], "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(result.mode, "v2_shared");
  assert.equal(result.tenant.shortId, "550e8400e29b");
  assert.equal(result.hash, "def5678");
});

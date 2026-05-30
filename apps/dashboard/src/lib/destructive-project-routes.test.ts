import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  DestructiveBackupBlockedError,
  DESTRUCTIVE_BACKUP_BLOCKED_STATUS,
} from "./destructive-backup-gate.ts";
import type { DestructiveProjectRow } from "./destructive-project-routes.ts";
import {
  runCliMigratePost,
  runCliProjectDelete,
  runDashboardFactoryReset,
  runDashboardProjectDelete,
} from "./destructive-project-routes.ts";

const PROJECT: DestructiveProjectRow = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "demo",
  hash: "abc1234",
  name: "Demo",
  mode: "v2_shared",
};

const V1_PROJECT: DestructiveProjectRow = {
  ...PROJECT,
  mode: "v1_dedicated",
};

const BLOCKED_MSG = "Latest backup is not restore-verified.";

function mockDeleteResult(): {
  ok: true;
  removed: {
    apiContainer: string;
    dbContainer: string;
    volume: string;
    privateNetwork: string;
  };
} {
  return {
    ok: true,
    removed: {
      apiContainer: "api",
      dbContainer: "db",
      volume: "vol",
      privateNetwork: "net",
    },
  };
}

function ctx(slugOrHash: string) {
  return { params: Promise.resolve({ slug: slugOrHash, hash: slugOrHash }) };
}

async function readError(res: Response): Promise<string> {
  const j = (await res.json()) as { error: string };
  return j.error;
}

function gateBlocked() {
  return async () => {
    throw new DestructiveBackupBlockedError(BLOCKED_MSG);
  };
}

function gateAllowed() {
  return async () => ({ tier: "restorable" as const, allowsDestructiveWithoutOverride: true, detail: "ok" });
}

test("dashboard delete: unauthorized returns 401 and skips gate and side effects", async () => {
  let gateCalls = 0;
  let deleteCalls = 0;
  const res = await runDashboardProjectDelete(
    new NextRequest("http://test.local/api/projects/demo", { method: "DELETE" }),
    ctx("demo"),
    {
      initSystemDb: async () => undefined,
      auth: async () => null,
      resolveOwnedProject: async () => PROJECT,
      assertDestructiveBackupAllowed: async () => {
        gateCalls++;
        return gateAllowed()();
      },
      listProjectHostnames: async () => [],
      evictHostnames: async () => undefined,
      deleteProjectInfrastructure: async () => {
        deleteCalls++;
      },
      deleteCatalogRow: async () => undefined,
    },
  );
  assert.equal(res.status, 401);
  assert.equal(gateCalls, 0);
  assert.equal(deleteCalls, 0);
});

test("dashboard delete: backup gate block returns 412 without side effects", async () => {
  let gateCalls = 0;
  let deleteCalls = 0;
  const res = await runDashboardProjectDelete(
    new NextRequest("http://test.local/api/projects/demo", { method: "DELETE" }),
    ctx("demo"),
    {
      initSystemDb: async () => undefined,
      auth: async () => ({ userId: "user-1" }),
      resolveOwnedProject: async () => PROJECT,
      assertDestructiveBackupAllowed: async () => {
        gateCalls++;
        return gateBlocked()();
      },
      listProjectHostnames: async () => [],
      evictHostnames: async () => undefined,
      deleteProjectInfrastructure: async () => {
        deleteCalls++;
      },
      deleteCatalogRow: async () => undefined,
    },
  );
  assert.equal(res.status, DESTRUCTIVE_BACKUP_BLOCKED_STATUS);
  assert.equal(await readError(res), BLOCKED_MSG);
  assert.equal(gateCalls, 1);
  assert.equal(deleteCalls, 0);
});

test("dashboard delete: skipBackupCheck bypasses gate and deletes", async () => {
  let gateCalls = 0;
  let deleteCalls = 0;
  const res = await runDashboardProjectDelete(
    new NextRequest(
      "http://test.local/api/projects/demo?skipBackupCheck=true",
      { method: "DELETE" },
    ),
    ctx("demo"),
    {
      initSystemDb: async () => undefined,
      auth: async () => ({ userId: "user-1" }),
      resolveOwnedProject: async () => PROJECT,
      assertDestructiveBackupAllowed: async (_id, opts) => {
        gateCalls++;
        assert.equal(opts?.skipBackupCheck, true);
        return gateAllowed()();
      },
      listProjectHostnames: async () => ["api.example.test"],
      evictHostnames: async () => undefined,
      deleteProjectInfrastructure: async () => {
        deleteCalls++;
      },
      deleteCatalogRow: async () => undefined,
    },
  );
  assert.equal(res.status, 200);
  assert.equal(gateCalls, 1);
  assert.equal(deleteCalls, 1);
});

test("dashboard delete: non-backup gate error is not converted to 412", async () => {
  await assert.rejects(
    () =>
      runDashboardProjectDelete(
        new NextRequest("http://test.local/api/projects/demo", { method: "DELETE" }),
        ctx("demo"),
        {
          initSystemDb: async () => undefined,
          auth: async () => ({ userId: "user-1" }),
          resolveOwnedProject: async () => PROJECT,
          assertDestructiveBackupAllowed: async () => {
            throw new Error("database unavailable");
          },
          listProjectHostnames: async () => [],
          evictHostnames: async () => undefined,
          deleteProjectInfrastructure: async () => undefined,
          deleteCatalogRow: async () => undefined,
        },
      ),
    /database unavailable/,
  );
});

test("dashboard factory reset: unauthorized skips gate and side effects", async () => {
  let gateCalls = 0;
  let resetCalls = 0;
  const res = await runDashboardFactoryReset(
    new NextRequest("http://test.local/api/projects/demo/factory-reset", {
      method: "POST",
    }),
    ctx("demo"),
    {
      initSystemDb: async () => undefined,
      auth: async () => null,
      loadOwnedProject: async () => V1_PROJECT,
      assertDestructiveBackupAllowed: async () => {
        gateCalls++;
        return gateAllowed()();
      },
      factoryResetProject: async () => {
        resetCalls++;
        return { apiUrl: "https://api.test", slug: "demo", mode: "v1_dedicated" };
      },
    },
  );
  assert.equal(res.status, 401);
  assert.equal(gateCalls, 0);
  assert.equal(resetCalls, 0);
});

test("dashboard factory reset: v2 project returns 400 before gate", async () => {
  let gateCalls = 0;
  const res = await runDashboardFactoryReset(
    new NextRequest("http://test.local/api/projects/demo/factory-reset", {
      method: "POST",
    }),
    ctx("demo"),
    {
      initSystemDb: async () => undefined,
      auth: async () => ({ userId: "user-1" }),
      loadOwnedProject: async () => PROJECT,
      assertDestructiveBackupAllowed: async () => {
        gateCalls++;
        return gateAllowed()();
      },
      factoryResetProject: async () => ({
        apiUrl: "https://api.test",
        slug: "demo",
        mode: "v1_dedicated",
      }),
    },
  );
  assert.equal(res.status, 400);
  assert.equal(gateCalls, 0);
});

test("dashboard factory reset: blocked backup returns 412 without reset", async () => {
  let resetCalls = 0;
  const res = await runDashboardFactoryReset(
    new NextRequest("http://test.local/api/projects/demo/factory-reset", {
      method: "POST",
    }),
    ctx("demo"),
    {
      initSystemDb: async () => undefined,
      auth: async () => ({ userId: "user-1" }),
      loadOwnedProject: async () => V1_PROJECT,
      assertDestructiveBackupAllowed: gateBlocked(),
      factoryResetProject: async () => {
        resetCalls++;
        return { apiUrl: "https://api.test", slug: "demo", mode: "v1_dedicated" };
      },
    },
  );
  assert.equal(res.status, DESTRUCTIVE_BACKUP_BLOCKED_STATUS);
  assert.equal(resetCalls, 0);
});

test("cli migrate: unauthorized skips gate and migration", async () => {
  let gateCalls = 0;
  let migrateCalls = 0;
  const res = await runCliMigratePost(
    new Request("http://test.local/api/cli/v1/migrate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "demo", hash: "abc1234" }),
    }),
    {
      initSystemDb: async () => undefined,
      authenticateCli: async () => null,
      findOwnedProjectId: async () => PROJECT.id,
      assertDestructiveBackupAllowed: async () => {
        gateCalls++;
        return gateAllowed()();
      },
      runMigration: async () => {
        migrateCalls++;
        return { ok: true };
      },
    },
  );
  assert.equal(res.status, 401);
  assert.equal(gateCalls, 0);
  assert.equal(migrateCalls, 0);
});

test("cli migrate: dryRun skips backup gate", async () => {
  let gateCalls = 0;
  let migrateCalls = 0;
  const res = await runCliMigratePost(
    new Request("http://test.local/api/cli/v1/migrate", {
      method: "POST",
      headers: {
        authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({ slug: "demo", hash: "abc1234", dryRun: true }),
    }),
    {
      initSystemDb: async () => undefined,
      authenticateCli: async () => ({ userId: "user-1" }),
      findOwnedProjectId: async () => {
        throw new Error("gate lookup should not run on dryRun");
      },
      assertDestructiveBackupAllowed: async () => {
        gateCalls++;
        return gateAllowed()();
      },
      runMigration: async () => {
        migrateCalls++;
        return { ok: true, dryRun: true };
      },
    },
  );
  assert.equal(res.status, 200);
  assert.equal(gateCalls, 0);
  assert.equal(migrateCalls, 1);
});

test("cli migrate: blocked backup returns 412 without migration", async () => {
  let migrateCalls = 0;
  const res = await runCliMigratePost(
    new Request("http://test.local/api/cli/v1/migrate", {
      method: "POST",
      headers: {
        authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({ slug: "demo", hash: "abc1234" }),
    }),
    {
      initSystemDb: async () => undefined,
      authenticateCli: async () => ({ userId: "user-1" }),
      findOwnedProjectId: async () => PROJECT.id,
      assertDestructiveBackupAllowed: gateBlocked(),
      runMigration: async () => {
        migrateCalls++;
        return { ok: true };
      },
    },
  );
  assert.equal(res.status, DESTRUCTIVE_BACKUP_BLOCKED_STATUS);
  assert.equal(migrateCalls, 0);
});

test("cli migrate: non-backup gate error is not converted to 412", async () => {
  await assert.rejects(
    () =>
      runCliMigratePost(
        new Request("http://test.local/api/cli/v1/migrate", {
          method: "POST",
          headers: {
            authorization: "Bearer test-key",
            "content-type": "application/json",
          },
          body: JSON.stringify({ slug: "demo", hash: "abc1234" }),
        }),
        {
          initSystemDb: async () => undefined,
          authenticateCli: async () => ({ userId: "user-1" }),
          findOwnedProjectId: async () => PROJECT.id,
          assertDestructiveBackupAllowed: async () => {
            throw new Error("backup catalog read failed");
          },
          runMigration: async () => ({ ok: true }),
        },
      ),
    /backup catalog read failed/,
  );
});

test("cli delete: unauthorized skips gate and delete", async () => {
  let gateCalls = 0;
  let deleteCalls = 0;
  const res = await runCliProjectDelete(
    new Request("http://test.local/api/cli/v1/projects/abc1234", {
      method: "DELETE",
      headers: { authorization: "Bearer test-key" },
    }),
    ctx("abc1234"),
    {
      initSystemDb: async () => undefined,
      authenticateCli: async () => null,
      findOwnedProjectByHash: async () => PROJECT,
      assertDestructiveBackupAllowed: async () => {
        gateCalls++;
        return gateAllowed()();
      },
      deleteProjectInfrastructure: async () => {
        deleteCalls++;
        return mockDeleteResult();
      },
      deleteCatalogRow: async () => undefined,
      deleteOrphanInfrastructure: async () => mockDeleteResult(),
    },
  );
  assert.equal(res.status, 401);
  assert.equal(gateCalls, 0);
  assert.equal(deleteCalls, 0);
});

test("cli delete: blocked backup returns 412 without delete", async () => {
  let deleteCalls = 0;
  const res = await runCliProjectDelete(
    new Request("http://test.local/api/cli/v1/projects/abc1234", {
      method: "DELETE",
      headers: { authorization: "Bearer test-key" },
    }),
    ctx("abc1234"),
    {
      initSystemDb: async () => undefined,
      authenticateCli: async () => ({ userId: "user-1" }),
      findOwnedProjectByHash: async () => PROJECT,
      assertDestructiveBackupAllowed: gateBlocked(),
      deleteProjectInfrastructure: async () => {
        deleteCalls++;
        return mockDeleteResult();
      },
      deleteCatalogRow: async () => undefined,
      deleteOrphanInfrastructure: async () => mockDeleteResult(),
    },
  );
  assert.equal(res.status, DESTRUCTIVE_BACKUP_BLOCKED_STATUS);
  assert.equal(deleteCalls, 0);
});

test("cli delete: skipBackupCheck bypasses gate", async () => {
  let gateCalls = 0;
  let deleteCalls = 0;
  const res = await runCliProjectDelete(
    new Request(
      "http://test.local/api/cli/v1/projects/abc1234?skipBackupCheck=true",
      {
        method: "DELETE",
        headers: { authorization: "Bearer test-key" },
      },
    ),
    ctx("abc1234"),
    {
      initSystemDb: async () => undefined,
      authenticateCli: async () => ({ userId: "user-1" }),
      findOwnedProjectByHash: async () => PROJECT,
      assertDestructiveBackupAllowed: async () => {
        gateCalls++;
        return gateBlocked()();
      },
      deleteProjectInfrastructure: async () => {
        deleteCalls++;
        return mockDeleteResult();
      },
      deleteCatalogRow: async () => undefined,
      deleteOrphanInfrastructure: async () => mockDeleteResult(),
    },
  );
  assert.equal(res.status, 200);
  assert.equal(gateCalls, 0);
  assert.equal(deleteCalls, 1);
});

test("cli delete: allowed gate deletes catalog row", async () => {
  let catalogDeletes = 0;
  const res = await runCliProjectDelete(
    new Request("http://test.local/api/cli/v1/projects/abc1234", {
      method: "DELETE",
      headers: { authorization: "Bearer test-key" },
    }),
    ctx("abc1234"),
    {
      initSystemDb: async () => undefined,
      authenticateCli: async () => ({ userId: "user-1" }),
      findOwnedProjectByHash: async () => PROJECT,
      assertDestructiveBackupAllowed: gateAllowed(),
      deleteProjectInfrastructure: async () => mockDeleteResult(),
      deleteCatalogRow: async () => {
        catalogDeletes++;
      },
      deleteOrphanInfrastructure: async () => mockDeleteResult(),
    },
  );
  assert.equal(res.status, 200);
  assert.equal(catalogDeletes, 1);
});

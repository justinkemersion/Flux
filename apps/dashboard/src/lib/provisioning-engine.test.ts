import test from "node:test";
import assert from "node:assert/strict";
import type { ProjectManager } from "@flux/core";
import { dispatchProvisionProject } from "./provisioning-engine";
import { deriveTenantIdentity, buildTenantBootstrapSql, buildClusterBootstrapSql } from "@flux/engine-v2";

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

// ---------------------------------------------------------------------------
// T-1: v2 cleanupOnFailure calls deprovisionProject
//
// Regression guard for CR-4: ensures the rollback path is not a silent no-op.
// Injects a spy as provisionSharedTenant and a stub deprovisionProject to
// verify that cleanupOnFailure triggers actual cleanup logic.
// ---------------------------------------------------------------------------
test("dispatchProvisionProject v2: cleanupOnFailure is not a no-op", async () => {
  const deprovisionedIds: string[] = [];
  const TENANT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

  const result = await dispatchProvisionProject({
    mode: "v2_shared",
    projectName: "Rollback Test",
    projectHash: "fff0001",
    tenantId: TENANT_ID,
    projectManager: {} as ProjectManager,
    isProduction: false,
    provisionSharedTenant: async (tenantId) => ({
      tenantId,
      shortId: "aaaaaaabbbbb",
      schema: "t_aaaaaaabbbbb_api",
      role: "t_aaaaaaabbbbb_role",
    }),
    // Inject a spy in place of the real deprovisionProject so this test does
    // not require a live Postgres connection.
    deprovisionSharedTenant: async (tenantId: string) => {
      deprovisionedIds.push(tenantId);
    },
  });

  // Before calling cleanupOnFailure nothing should have been deprovisioned.
  assert.equal(deprovisionedIds.length, 0, "no cleanup before failure");

  // Simulate the catalog INSERT failing — trigger the rollback.
  await result.cleanupOnFailure();

  assert.equal(deprovisionedIds.length, 1, "cleanup must run exactly once");
  assert.equal(deprovisionedIds[0], TENANT_ID, "cleanup must target the correct tenant");
});

// ---------------------------------------------------------------------------
// T-2: buildTenantBootstrapSql idempotency — structural SQL guards
//
// Verifies that the generated SQL contains the IF NOT EXISTS guard for the
// role and CREATE SCHEMA IF NOT EXISTS for the schema, so partial execution
// is always recoverable without manual intervention.
// ---------------------------------------------------------------------------
test("buildTenantBootstrapSql contains idempotency guards", () => {
  const identity = deriveTenantIdentity("11111111-2222-4333-8444-555555555555");
  const sql = buildTenantBootstrapSql(identity);

  assert.ok(
    sql.includes("CREATE SCHEMA IF NOT EXISTS"),
    "schema creation must use IF NOT EXISTS",
  );
  assert.ok(
    sql.includes("IF NOT EXISTS") && sql.includes("pg_catalog.pg_roles"),
    "role creation must be guarded by an IF NOT EXISTS check against pg_roles",
  );
  assert.ok(
    sql.includes("pg_notify('pgrst', 'reload config')"),
    "bootstrap SQL must signal PostgREST to reload its config after schema creation",
  );
  // Strict isolation: public must not appear in the search_path assignment.
  const searchPathLine = sql
    .split("\n")
    .find((l) => l.includes("SET search_path"));
  assert.ok(searchPathLine, "bootstrap SQL must set search_path");
  assert.ok(
    !searchPathLine!.includes("public"),
    "tenant role search_path must not include public (strict schema isolation)",
  );
});

// ---------------------------------------------------------------------------
// T-3: buildClusterBootstrapSql contains both required hook functions
//
// Regression guard for CR-3: verifies the cluster-level bootstrap SQL installs
// both PostgREST hooks so a deploy script omission is caught in CI.
// ---------------------------------------------------------------------------
test("buildClusterBootstrapSql installs both PostgREST hook functions", () => {
  const sql = buildClusterBootstrapSql(15_000);

  assert.ok(
    sql.includes("flux_postgrest_config"),
    "cluster bootstrap must define flux_postgrest_config (pre-config hook)",
  );
  assert.ok(
    sql.includes("flux_set_tenant_context"),
    "cluster bootstrap must define flux_set_tenant_context (pre-request hook)",
  );
  assert.ok(
    sql.includes("CREATE OR REPLACE FUNCTION"),
    "cluster bootstrap must use CREATE OR REPLACE for idempotency",
  );
  assert.ok(
    sql.includes("pgrst.db_schemas"),
    "pre-config hook must set pgrst.db_schemas",
  );
  assert.ok(
    sql.includes("SET LOCAL search_path"),
    "pre-request hook must use SET LOCAL for PgBouncer transaction-mode compatibility",
  );
  assert.ok(
    sql.includes("SET LOCAL statement_timeout"),
    "pre-request hook must enforce statement_timeout per transaction",
  );
});

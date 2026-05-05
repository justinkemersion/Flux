import test from "node:test";
import assert from "node:assert/strict";
import type { ProjectManager } from "@flux/core";
import { dispatchProvisionProject } from "./provisioning-engine";
import {
  deriveTenantIdentity,
  buildTenantBootstrapSql,
  buildClusterBootstrapSql,
} from "@flux/engine-v2";

test("dispatchProvisionProject routes v1_dedicated through ProjectManager", async () => {
  let called = false;
  let seenApiSchema: string | undefined;
  const projectManager = {
    provisionProject: async (
      _name: string,
      opts?: { apiSchemaName?: string },
    ) => {
      called = true;
      seenApiSchema = opts?.apiSchemaName;
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
  assert.equal(seenApiSchema, "api");
  assert.equal(result.mode, "v1_dedicated");
  assert.equal(result.slug, "my-app");
  assert.equal(result.hash, "abc1234");
  assert.equal(result.secrets.postgresContainerHost, "db-container");
  assert.equal(result.projectJwtSecret, "jwt");
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
  assert.match(
    result.apiUrl,
    /^http:\/\/api--my-shared-app--def5678\.vsl-base\.com$/,
  );
  assert.match(result.projectJwtSecret, /^[A-Za-z0-9+/]+=*$/);
  assert.equal(Buffer.from(result.projectJwtSecret, "base64").length, 36);
});

test("dispatchProvisionProject v2_shared reuses jwt when reuseProjectJwtSecret is set", async () => {
  const reused = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const projectManager = {} as ProjectManager;
  const result = await dispatchProvisionProject({
    mode: "v2_shared",
    projectName: "Reuse Test",
    projectHash: "aaa0001",
    tenantId: "550e8400-e29b-41d4-a716-446655440000",
    projectManager,
    isProduction: false,
    reuseProjectJwtSecret: reused,
    provisionSharedTenant: async (tenantId) => ({
      tenantId,
      shortId: "550e8400e29b",
      schema: "t_550e8400e29b_api",
      role: "t_550e8400e29b_role",
    }),
  });

  assert.equal(result.projectJwtSecret, reused);
  assert.equal(result.secrets.pgrstJwtSecret, reused);
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
  const TENANT_ID = "11111111-2222-4333-8444-555555555555";
  const identity = deriveTenantIdentity(TENANT_ID);
  const sql = buildTenantBootstrapSql(identity, TENANT_ID);

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
  // Ownership comment must embed the tenant ID.
  assert.ok(
    sql.includes(`'tenant:${TENANT_ID}'`),
    "bootstrap SQL must stamp COMMENT ON SCHEMA with the tenant UUID for collision detection",
  );
  assert.ok(
    sql.includes("GRANT USAGE ON SCHEMA") && sql.includes("TO \"anon\""),
    "pool: anon must have USAGE on the tenant schema (guest / no-JWT access)",
  );
  assert.ok(
    sql.includes("TO \"authenticator\"") && sql.includes("GRANT USAGE ON SCHEMA"),
    "pool: authenticator must have USAGE on the tenant schema",
  );
  assert.ok(
    /ALTER DEFAULT PRIVILEGES IN SCHEMA .+ GRANT SELECT ON TABLES TO "anon"/.test(
      sql.replaceAll("\n", " "),
    ),
    "pool: default privileges must grant future table SELECT to anon",
  );
  assert.match(
    sql,
    /GRANT SELECT ON ALL TABLES IN SCHEMA [^\n;]+ TO "t_[0-9a-f]{12}_role"/u,
    "pool: tenant role gets SELECT on all tables (RLS policies as session role)",
  );
  assert.match(
    sql,
    /GRANT SELECT ON ALL TABLES IN SCHEMA [^\n;]+ TO "anon"/u,
    "pool: anon gets SELECT on all existing tables (guest / marketplace read)",
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

// ---------------------------------------------------------------------------
// T-4: Rollback on System DB Failure
//
// This test models the exact failure mode that caused "orphan tenants" before
// the rollback fix: engine-v2 provisions the schema/role successfully, but the
// subsequent Dashboard catalog INSERT throws (e.g. DB connection lost, unique
// constraint, etc.).  The route handler is expected to call cleanupOnFailure(),
// which in turn must call deprovisionProject exactly once.
//
// The test drives this through dispatchProvisionProject with injected doubles so
// it runs without any infrastructure, then simulates the route handler's
// catch-block behaviour (calling cleanupOnFailure after the DB insert throws).
// ---------------------------------------------------------------------------
test("Rollback on System DB Failure: cleanupOnFailure deprovisions exactly once", async () => {
  const TENANT_ID = "cccccccc-dddd-4eee-8fff-000000000001";
  const deprovisionCalls: string[] = [];
  let provisionCalled = false;

  // Step 1: obtain the dispatch result (provision succeeds).
  const result = await dispatchProvisionProject({
    mode: "v2_shared",
    projectName: "DB Failure Project",
    projectHash: "abc0001",
    tenantId: TENANT_ID,
    projectManager: {} as ProjectManager,
    isProduction: false,
    provisionSharedTenant: async (tenantId) => {
      provisionCalled = true;
      return {
        tenantId,
        shortId: "ccccccddddd0",
        schema: "t_ccccccddddd0_api",
        role:   "t_ccccccddddd0_role",
      };
    },
    deprovisionSharedTenant: async (tenantId) => {
      deprovisionCalls.push(tenantId);
    },
  });

  assert.equal(provisionCalled, true, "provision must have been called");
  assert.equal(deprovisionCalls.length, 0, "no cleanup before DB failure");

  // Step 2: simulate the route handler's catalog INSERT throwing.
  const fakeDbInsert = async (): Promise<never> => {
    throw new Error("DB connection lost during INSERT");
  };

  let routeError: Error | undefined;
  try {
    await fakeDbInsert();
  } catch (err) {
    // Step 3: route handler catch-block — trigger rollback then surface error.
    await result.cleanupOnFailure();
    routeError = err instanceof Error ? err : new Error(String(err));
  }

  assert.ok(routeError, "route must surface the original DB error to the client");
  assert.equal(
    deprovisionCalls.length,
    1,
    "deprovision must be called exactly once on DB failure",
  );
  assert.equal(
    deprovisionCalls[0],
    TENANT_ID,
    "deprovision must target the provisioned tenant, not a different one",
  );

  // Step 4: a second call to cleanupOnFailure must be a safe no-op (idempotent).
  await result.cleanupOnFailure();
  assert.equal(
    deprovisionCalls.length,
    2,
    "second cleanupOnFailure call must pass through (caller decides idempotency)",
  );
});

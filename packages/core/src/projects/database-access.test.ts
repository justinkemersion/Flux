import test from "node:test";
import assert from "node:assert/strict";
import {
  redactDatabaseAccessPlan,
  resolveProjectDatabaseAccess,
  resolveDefaultSshTunnelConfig,
} from "./database-access.ts";

const V1_PROJECT_ID = "5ecfa3ab-72d1-4b3a-9c8e-111111111111";

test("resolveProjectDatabaseAccess: v1 dedicated plan", () => {
  const plan = resolveProjectDatabaseAccess(
    {
      id: V1_PROJECT_ID,
      slug: "yeastcoast",
      hash: "ffca33f",
      mode: "v1_dedicated",
    },
    {
      sshHost: "178.104.205.138",
      sshUser: "root",
      localPort: 15432,
    },
  );

  assert.equal(plan.mode, "v1_dedicated");
  if (plan.mode !== "v1_dedicated") return;
  assert.equal(plan.supported, true);
  assert.equal(plan.projectName, "yeastcoast");
  assert.equal(plan.projectHash, "ffca33f");
  assert.equal(plan.database.containerName, "flux-ffca33f-yeastcoast-db");
  assert.equal(plan.database.internalHost, "flux-ffca33f-yeastcoast-db");
  assert.equal(plan.database.username, "postgres");
  assert.equal(plan.tunnel.recommendedLocalPort, 15432);
  assert.equal(plan.capabilities.tunnel, true);
  assert.equal(plan.capabilities.shell, true);
  assert.equal(plan.capabilities.restore, true);
});

test("resolveProjectDatabaseAccess: v2 pooled supported plan", () => {
  const plan = resolveProjectDatabaseAccess({
    id: V1_PROJECT_ID,
    slug: "yeastcoast",
    hash: "ffca33f",
    mode: "v2_shared",
  });

  assert.equal(plan.mode, "v2_shared");
  if (plan.mode !== "v2_shared") return;
  assert.equal(plan.supported, true);
  assert.equal(plan.tenantSchema, "t_5ecfa3ab72d1_api");
  assert.equal(plan.capabilities.tunnel, true);
  assert.equal(plan.capabilities.restore, false);
  assert.equal(plan.capabilities.temporaryCredentials, true);
});

test("redactDatabaseAccessPlan returns clone without secret keys", () => {
  const plan = resolveProjectDatabaseAccess({
    id: V1_PROJECT_ID,
    slug: "demo",
    hash: "abc1234",
    mode: "v1_dedicated",
  });
  const redacted = redactDatabaseAccessPlan(plan);
  const json = JSON.stringify(redacted);
  assert.doesNotMatch(json, /postgresql:\/\/|postgresConnectionString|jwtSecret|serviceRoleKey/i);
});

test("resolveDefaultSshTunnelConfig parses DOCKER_HOST ssh URL", () => {
  const prev = process.env.DOCKER_HOST;
  process.env.DOCKER_HOST = "ssh://deploy@flux.example.com";
  try {
    const cfg = resolveDefaultSshTunnelConfig();
    assert.equal(cfg.sshHost, "flux.example.com");
    assert.equal(cfg.sshUser, "deploy");
    assert.equal(cfg.sshPort, 22);
  } finally {
    if (prev === undefined) delete process.env.DOCKER_HOST;
    else process.env.DOCKER_HOST = prev;
  }
});

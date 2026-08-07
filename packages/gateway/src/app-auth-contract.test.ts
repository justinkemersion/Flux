import test from "node:test";
import assert from "node:assert/strict";
import { V2_GATEWAY_AUTH_REQUIRED_ERROR } from "@flux/core";
import { memSet } from "./cache.ts";
import type { TenantResolution } from "./types.ts";

const TENANT_ID = "7cdd9f01-81de-45c9-a661-c4f24b2f89f1";
const HOST = "api--demo--abc1234.flux.localhost";

const TENANT: TenantResolution = {
  projectId: TENANT_ID,
  tenantId: TENANT_ID,
  shortid: "7cdd9f0181de",
  mode: "v2_shared",
  slug: "demo",
  jwtSecret: "project-secret-for-tests-32-characters",
  migrationStatus: null,
  lifecycleState: "active",
};

function setGatewayEnv(): void {
  process.env.FLUX_SYSTEM_DATABASE_URL =
    "postgres://test:test@localhost:5432/flux";
  process.env.FLUX_GATEWAY_JWT_SECRET =
    "gateway-secret-for-tests-minimum-32";
  process.env.FLUX_POSTGREST_POOL_URL = "http://127.0.0.1:39999";
  process.env.FLUX_BASE_DOMAIN = "flux.localhost";
}

test("v2 gateway fails closed on unauthenticated GET /profiles", async () => {
  setGatewayEnv();
  memSet(`hostname:${HOST}`, TENANT);

  const { createApp } = await import("./app.ts");
  const app = createApp();

  const res = await app.request("http://localhost/rest/v1/profiles", {
    method: "GET",
    headers: { host: HOST },
  });

  assert.equal(res.status, 401);
  const body = (await res.json()) as { error?: string };
  assert.equal(body.error, V2_GATEWAY_AUTH_REQUIRED_ERROR);
});

test("v2 gateway rejects empty Bearer before proxy", async () => {
  setGatewayEnv();
  memSet(`hostname:${HOST}`, TENANT);

  const { createApp } = await import("./app.ts");
  const app = createApp();

  const res = await app.request("http://localhost/rest/v1/profiles", {
    method: "GET",
    headers: {
      host: HOST,
      authorization: "Bearer ",
    },
  });

  assert.equal(res.status, 401);
  const body = (await res.json()) as { error?: string };
  assert.equal(body.error, V2_GATEWAY_AUTH_REQUIRED_ERROR);
});

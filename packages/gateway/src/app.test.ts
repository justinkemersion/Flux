import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { defaultTenantRoleFromProjectId } from "@flux/core/api-schema-strategy";
import type { TenantResolution } from "./types.ts";
import type { ResolvedTenant } from "./tenant-resolver.ts";

const PROJECT_SECRET = "project-secret-for-tests-32-characters";
const TENANT_ID = "7cdd9f01-81de-45c9-a661-c4f24b2f89f1";
const HOST = "api--demo--abc1234.flux.localhost";

const TENANT: TenantResolution = {
  projectId: TENANT_ID,
  tenantId: TENANT_ID,
  shortid: "7cdd9f0181de",
  mode: "v2_shared",
  slug: "demo",
  jwtSecret: PROJECT_SECRET,
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
  process.env.FLUX_GATEWAY_BLOCK_BOT_USER_AGENTS = "0";
}

async function loadCreateApp() {
  setGatewayEnv();
  const mod = await import("./app.ts");
  return mod.createApp;
}

function resolvedTenant(): ResolvedTenant {
  return { resolution: TENANT, cacheSource: "memory" };
}

async function signProjectJwt(payload: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({ sub: "user_test", role: "authenticated", ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(PROJECT_SECRET));
}

test("createApp: /health is reachable without Authorization", async () => {
  const createApp = await loadCreateApp();
  const app = createApp();
  const res = await app.request(`http://${HOST}/health`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string };
  assert.equal(body.status, "ok");
});

test("createApp: unauthenticated /profiles returns 401 before upstream proxy", async () => {
  const createApp = await loadCreateApp();
  let proxyCalled = false;
  const app = createApp({
    resolveTenant: async () => resolvedTenant(),
    proxyRequest: async () => {
      proxyCalled = true;
      return new Response("should not reach upstream", { status: 200 });
    },
    acquireRateSlot: async () => true,
    trackActivity: () => undefined,
  });

  const res = await app.request(`http://${HOST}/profiles`, {
    headers: { host: HOST },
  });

  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "authorization required");
  assert.equal(proxyCalled, false);
});

test("createApp: invalid Bearer /profiles returns 401", async () => {
  const createApp = await loadCreateApp();
  const app = createApp({
    resolveTenant: async () => resolvedTenant(),
    proxyRequest: async () => new Response("upstream", { status: 200 }),
    acquireRateSlot: async () => true,
    trackActivity: () => undefined,
  });

  const res = await app.request(`http://${HOST}/profiles`, {
    headers: {
      host: HOST,
      authorization: "Bearer not-a-jwt",
    },
  });

  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "invalid or expired token");
});

test("createApp: valid project JWT bridges to tenant-role downstream token", async () => {
  const createApp = await loadCreateApp();
  const token = await signProjectJwt();
  let capturedAuth: string | null = null;

  const app = createApp({
    resolveTenant: async () => resolvedTenant(),
    proxyRequest: async (_c, downstreamJwt) => {
      capturedAuth = downstreamJwt;
      return Response.json({ ok: true }, { status: 200 });
    },
    acquireRateSlot: async () => true,
    trackActivity: () => undefined,
  });

  const res = await app.request(`http://${HOST}/profiles`, {
    headers: {
      host: HOST,
      authorization: `Bearer ${token}`,
    },
  });

  assert.equal(res.status, 200);
  assert.ok(capturedAuth);
  const verified = await jwtVerify(
    capturedAuth!,
    new TextEncoder().encode(process.env.FLUX_GATEWAY_JWT_SECRET!),
    { algorithms: ["HS256"] },
  );
  assert.equal(verified.payload.sub, "user_test");
  assert.equal(
    verified.payload.role,
    defaultTenantRoleFromProjectId(TENANT_ID),
  );
  assert.equal(verified.payload.tenant_id, TENANT_ID);
});

test("createApp: unknown host returns 404 without auth check", async () => {
  const createApp = await loadCreateApp();
  let verifyCalled = false;
  const app = createApp({
    resolveTenant: async () => null,
    verifyInboundProjectBearer: async () => {
      verifyCalled = true;
      return { ok: true, downstreamJwt: "unused" };
    },
  });

  const res = await app.request(`http://unknown.example.test/profiles`, {
    headers: { host: "unknown.example.test" },
  });

  assert.equal(res.status, 404);
  assert.equal(verifyCalled, false);
});

test("gateway contract version is semver 1.0.0", async () => {
  setGatewayEnv();
  const { FLUX_GATEWAY_CONTRACT_VERSION } = await import("./gateway-contract.ts");
  assert.equal(FLUX_GATEWAY_CONTRACT_VERSION, "1.0.0");
});

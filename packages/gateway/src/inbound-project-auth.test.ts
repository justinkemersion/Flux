import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import type { TenantResolution } from "./types.ts";

const PROJECT_SECRET = "project-secret-for-tests-32-characters";
const TENANT_ID = "7cdd9f01-81de-45c9-a661-c4f24b2f89f1";

const TENANT: TenantResolution = {
  projectId: TENANT_ID,
  tenantId: TENANT_ID,
  shortid: "7cdd9f0181de",
  mode: "v2_shared",
  slug: "demo",
  jwtSecret: PROJECT_SECRET,
  migrationStatus: null,
};

function setGatewayEnv(): void {
  process.env.FLUX_SYSTEM_DATABASE_URL =
    "postgres://test:test@localhost:5432/flux";
  process.env.FLUX_GATEWAY_JWT_SECRET =
    "gateway-secret-for-tests-minimum-32";
  process.env.FLUX_POSTGREST_POOL_URL = "http://127.0.0.1:39999";
  process.env.FLUX_BASE_DOMAIN = "flux.localhost";
}

async function loadInboundAuth() {
  setGatewayEnv();
  return import("./inbound-project-auth.ts");
}

async function signProjectJwt(): Promise<string> {
  return new SignJWT({ sub: "user_test", role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(PROJECT_SECRET));
}

test("verifyInboundProjectBearer rejects missing Authorization", async () => {
  const { verifyInboundProjectBearer } = await loadInboundAuth();
  const result = await verifyInboundProjectBearer(undefined, TENANT);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 401);
    assert.equal(result.error, "authorization required");
  }
});

test("verifyInboundProjectBearer rejects empty Bearer token", async () => {
  const { verifyInboundProjectBearer } = await loadInboundAuth();
  const result = await verifyInboundProjectBearer("Bearer ", TENANT);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 401);
});

test("verifyInboundProjectBearer rejects invalid JWT", async () => {
  const { verifyInboundProjectBearer } = await loadInboundAuth();
  const result = await verifyInboundProjectBearer(
    "Bearer not-a-valid-jwt",
    TENANT,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 401);
});

test("verifyInboundProjectBearer mints bridge JWT for valid project token", async () => {
  const { verifyInboundProjectBearer } = await loadInboundAuth();
  const token = await signProjectJwt();
  const result = await verifyInboundProjectBearer(`Bearer ${token}`, TENANT);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.downstreamJwt.length > 0);
  }
});

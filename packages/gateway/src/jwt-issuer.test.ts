import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT, jwtVerify } from "jose";

const PROJECT_SECRET = "project-secret-for-tests-32-characters";

async function loadIssuerModule() {
  process.env.FLUX_SYSTEM_DATABASE_URL ??= "postgres://test:test@localhost:5432/flux";
  process.env.FLUX_GATEWAY_JWT_SECRET ??= "gateway-secret-for-tests-minimum-32";
  process.env.FLUX_POSTGREST_POOL_URL ??= "http://127.0.0.1:3000";
  process.env.FLUX_BASE_DOMAIN ??= "flux.localhost";
  return import("./jwt-issuer.ts");
}

async function signExternalToken(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(PROJECT_SECRET));
}

test("accepts valid external token and re-signs internal token", async () => {
  const { mintBridgeJwt } = await loadIssuerModule();
  const external = await signExternalToken({
    sub: "user_123",
    email: "u@example.com",
    role: "service_role",
  });

  const { token, claims } = await mintBridgeJwt(external, PROJECT_SECRET);

  assert.equal(claims.sub, "user_123");
  assert.equal(claims.email, "u@example.com");
  assert.equal(claims.role, "authenticated");

  const internal = await jwtVerify(
    token,
    new TextEncoder().encode(process.env.FLUX_GATEWAY_JWT_SECRET!),
    { algorithms: ["HS256"] },
  );

  assert.equal(internal.payload.sub, "user_123");
  assert.equal(internal.payload.email, "u@example.com");
  assert.equal(internal.payload.role, "authenticated");
  assert.equal(typeof internal.payload.iat, "number");
  assert.equal(typeof internal.payload.exp, "number");
  assert.ok((internal.payload.exp as number) - (internal.payload.iat as number) <= 300);
});

test("rejects token signed with wrong project secret", async () => {
  const { mintBridgeJwt } = await loadIssuerModule();
  const wrongSecretToken = await new SignJWT({ sub: "user_123" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode("wrong-project-secret-32-characters"));

  await assert.rejects(
    () => mintBridgeJwt(wrongSecretToken, PROJECT_SECRET),
    /signature verification failed/i,
  );
});

test("sanitizes role escalation attempt to authenticated", async () => {
  const { mintBridgeJwt } = await loadIssuerModule();
  const external = await signExternalToken({
    sub: "user_456",
    role: "service_role",
  });
  const { token } = await mintBridgeJwt(external, PROJECT_SECRET);

  const internal = await jwtVerify(
    token,
    new TextEncoder().encode(process.env.FLUX_GATEWAY_JWT_SECRET!),
    { algorithms: ["HS256"] },
  );

  assert.equal(internal.payload.role, "authenticated");
});

test("rejects token missing sub claim", async () => {
  const { mintBridgeJwt } = await loadIssuerModule();
  const missingSub = await signExternalToken({
    email: "u@example.com",
  });

  await assert.rejects(() => mintBridgeJwt(missingSub, PROJECT_SECRET), /missing sub claim/i);
});

test("coerces non-string email claim to null", async () => {
  const { mintBridgeJwt } = await loadIssuerModule();
  const external = await signExternalToken({
    sub: "user_789",
    email: 42,
  });

  const { claims, token } = await mintBridgeJwt(external, PROJECT_SECRET);
  assert.equal(claims.email, null);

  const internal = await jwtVerify(
    token,
    new TextEncoder().encode(process.env.FLUX_GATEWAY_JWT_SECRET!),
    { algorithms: ["HS256"] },
  );
  assert.equal(internal.payload.email, null);
});

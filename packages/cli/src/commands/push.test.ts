import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mintServiceRoleJwt } from "./push";

function base64UrlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

test("mintServiceRoleJwt produces a valid HS256 token (header, payload, signature)", () => {
  const secret = "test-secret-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
  const hash = "abc1234";
  const token = mintServiceRoleJwt(secret, hash);

  const parts = token.split(".");
  assert.equal(parts.length, 3, "JWT must have 3 dot-separated segments");

  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  const header = JSON.parse(base64UrlDecode(headerB64).toString("utf8")) as Record<string, unknown>;
  assert.equal(header.alg, "HS256");
  assert.equal(header.typ, "JWT");

  const payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8")) as Record<string, unknown>;
  assert.equal(payload.role, "service_role");
  assert.equal(payload.hash, hash);
  assert.equal(typeof payload.iat, "number");
  assert.equal(typeof payload.nbf, "number");
  assert.equal(typeof payload.exp, "number");
  assert.ok(
    (payload.exp as number) - (payload.iat as number) === 60,
    "exp must be iat + 60 (60s TTL)",
  );
  assert.ok(
    (payload.nbf as number) === (payload.iat as number) - 5,
    "nbf must be iat - 5 (small back-skew)",
  );

  const expectedSig = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64")
    .replace(/=+$/u, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  assert.equal(
    signatureB64,
    expectedSig,
    "signature must match HMAC-SHA256(secret, header.payload) in base64url",
  );
});

test("mintServiceRoleJwt produces stable tokens given the same inputs at the same second", () => {
  const secret = "stable-secret";
  const hash = "1234567";
  const a = mintServiceRoleJwt(secret, hash);
  const b = mintServiceRoleJwt(secret, hash);
  // iat may differ if the test crosses a second boundary; allow either equality
  // or matching headers + identical signatures relative to their own payloads.
  const [aHeader, aPayload, aSig] = a.split(".") as [string, string, string];
  const [bHeader, bPayload, bSig] = b.split(".") as [string, string, string];
  assert.equal(aHeader, bHeader, "headers must always match");
  if (aPayload === bPayload) {
    assert.equal(aSig, bSig, "identical payload must yield identical signature");
  } else {
    // Verify each token is internally consistent (signature recomputable).
    for (const [h, p, s] of [[aHeader, aPayload, aSig], [bHeader, bPayload, bSig]] as const) {
      const recomputed = createHmac("sha256", secret)
        .update(`${h}.${p}`)
        .digest("base64")
        .replace(/=+$/u, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
      assert.equal(s, recomputed);
    }
  }
});

test("mintServiceRoleJwt signature changes with the secret", () => {
  const a = mintServiceRoleJwt("secret-a", "1111111");
  const b = mintServiceRoleJwt("secret-b", "1111111");
  const [, , aSig] = a.split(".") as [string, string, string];
  const [, , bSig] = b.split(".") as [string, string, string];
  assert.notEqual(aSig, bSig, "different secrets must yield different signatures");
});

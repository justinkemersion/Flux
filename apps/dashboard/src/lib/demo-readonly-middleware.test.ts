import test from "node:test";
import assert from "node:assert/strict";
import { demoReadOnlyMiddleware } from "./demo-readonly-middleware";
import { NextRequest } from "next/server";

test("demoReadOnlyMiddleware blocks mutating API requests for demo JWT", async () => {
  const prevSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "demo-readonly-test-secret-at-least-32-chars";

  const { encode } = await import("next-auth/jwt");
  const token = await encode({
    token: { sub: "demo-user", isDemo: true },
    secret: process.env.AUTH_SECRET,
    salt: "authjs.session-token",
  });

  const req = new NextRequest("http://test.local/api/projects", {
    method: "POST",
    headers: {
      cookie: `authjs.session-token=${token}`,
    },
  });

  try {
    const res = await demoReadOnlyMiddleware(req);
    assert.ok(res);
    assert.equal(res!.status, 403);
  } finally {
    if (prevSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = prevSecret;
  }
});

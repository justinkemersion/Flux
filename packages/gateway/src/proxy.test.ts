import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

function setGatewayEnv(poolUrl: string): void {
  process.env.FLUX_SYSTEM_DATABASE_URL ??= "postgres://test:test@localhost:5432/flux";
  process.env.FLUX_GATEWAY_JWT_SECRET ??= "gateway-secret-for-tests-minimum-32";
  process.env.FLUX_BASE_DOMAIN ??= "flux.localhost";
  process.env.FLUX_POSTGREST_POOL_URL = poolUrl;
}

test("proxy forwards internal auth token and POST body", async () => {
  let seenAuthorization: string | undefined;
  let seenUserId: string | undefined;
  let seenRole: string | undefined;
  let seenTenantId: string | undefined;
  let seenAcceptProfile: string | undefined;
  let seenContentProfile: string | undefined;
  let seenMethod: string | undefined;
  let seenContentType: string | undefined;
  let seenBody = "";

  const server = createServer((req, res) => {
    seenMethod = req.method;
    seenAuthorization = req.headers.authorization;
    seenUserId = req.headers["x-user-id"] as string | undefined;
    seenRole = req.headers["x-role"] as string | undefined;
    seenTenantId = req.headers["x-tenant-id"] as string | undefined;
    seenAcceptProfile = req.headers["accept-profile"] as string | undefined;
    seenContentProfile = req.headers["content-profile"] as string | undefined;
    seenContentType = req.headers["content-type"] as string | undefined;
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      seenBody += chunk;
    });
    req.on("end", () => {
      res.statusCode = 200;
      res.end("ok");
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to start test server");
  }

  setGatewayEnv(`http://127.0.0.1:${String(address.port)}`);
  const { proxyRequest } = await import("./proxy.ts");

  const c = {
    req: {
      method: "GET",
      url: "http://tenant.flux.localhost/rest/v1/items?limit=1",
      raw: new Request("http://tenant.flux.localhost/rest/v1/items?limit=1", {
        headers: {
          authorization: "Bearer external-client-token",
          "x-user-id": "spoofed-user",
          "x-role": "service_role",
        },
      }),
    },
  };

  const tenant = {
    tenantId: "7cdd9f01-81de-45c9-a661-c4f24b2f89f1",
    projectId: "7cdd9f01-81de-45c9-a661-c4f24b2f89f1",
    shortid: "aabbccddeeff",
    mode: "v2_shared" as const,
    slug: "demo",
    jwtSecret: null,
    migrationStatus: null as string | null,
  };

  try {
    const internalToken = "internal-bridge-token";
    const response = await proxyRequest(c as never, internalToken, tenant);

    assert.equal(response.status, 200);
    assert.equal(seenMethod, "GET");
    assert.equal(seenAuthorization, `Bearer ${internalToken}`);
    assert.equal(seenAuthorization?.includes("external-client-token"), false);
    assert.equal(seenUserId, undefined);
    assert.equal(seenRole, undefined);
    assert.equal(seenTenantId, tenant.tenantId);
    assert.equal(seenAcceptProfile, `t_${tenant.shortid}_api`);
    assert.equal(seenContentProfile, `t_${tenant.shortid}_api`);

    seenMethod = undefined;
    seenContentType = undefined;
    seenBody = "";
    const payload = { owner_id: "user-a", title: "A's product" };
    const postC = {
      req: {
        method: "POST",
        url: "http://tenant.flux.localhost/products",
        raw: new Request("http://tenant.flux.localhost/products", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        }),
      },
    };
    const postResponse = await proxyRequest(postC as never, internalToken, tenant);
    assert.equal(postResponse.status, 200);
    assert.equal(seenMethod, "POST");
    assert.equal(seenContentType, "application/json");
    assert.equal(seenBody, JSON.stringify(payload));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

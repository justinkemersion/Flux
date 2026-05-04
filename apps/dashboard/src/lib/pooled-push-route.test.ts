import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import type { ExecutePushInput } from "./pooled-push";
import { runPooledPushPost } from "./pooled-push-route";

const JWT_SECRET = "pooled-route-test-secret-32chars!!";
const VALID_HASH = "abcd123";
const TENANT_PROJECT_ID = "5ecfa3ab-72d1-4b3a-9c8e-111111111111";
const EXPECTED_SCHEMA = "t_5ecfa3ab72d1_api";

function ctx(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

/** Omit header when `bearer` is null. */
function pooledPushRequest(
  body: Record<string, unknown>,
  bearer: string | null,
): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (bearer !== null) {
    headers.set("authorization", `Bearer ${bearer}`);
  }
  return new NextRequest("http://test.local/api/projects/push", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function mintServiceRoleJwt(role: string): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function readError(res: Response): Promise<string> {
  const j = (await res.json()) as { error: string };
  return j.error;
}

test("blank slug returns 400", async () => {
  const res = await runPooledPushPost(
    pooledPushRequest({ hash: VALID_HASH, sql: "select 1" }, await mintServiceRoleJwt("service_role")),
    ctx("   "),
    {
      initSystemDb: async () => undefined,
      loadProjectForPush: async () => null,
      executePooledPush: async () => undefined,
    },
  );
  assert.equal(res.status, 400);
  assert.equal(await readError(res), "slug is required");
});

test("missing bearer returns 401", async () => {
  const res = await runPooledPushPost(
    pooledPushRequest({ hash: VALID_HASH, sql: "select 1" }, null),
    ctx("proj"),
    {
      initSystemDb: async () => undefined,
      loadProjectForPush: async () => ({
        id: TENANT_PROJECT_ID,
        mode: "v2_shared",
        jwtSecret: JWT_SECRET,
      }),
      executePooledPush: async () => undefined,
    },
  );
  assert.equal(res.status, 401);
  assert.equal(await readError(res), "Missing bearer token");
});

test("bad project hash returns 400", async () => {
  const token = await mintServiceRoleJwt("service_role");
  const res = await runPooledPushPost(
    pooledPushRequest({ hash: "not_hex", sql: "select 1" }, token),
    ctx("proj"),
    {
      initSystemDb: async () => undefined,
      loadProjectForPush: async () => null,
      executePooledPush: async () => undefined,
    },
  );
  assert.equal(res.status, 400);
  assert.match(await readError(res), /hash must be a/);
});

test("oversized SQL returns 413 when maxSqlBytes is enforced", async () => {
  const token = await mintServiceRoleJwt("service_role");
  const res = await runPooledPushPost(
    pooledPushRequest({ hash: VALID_HASH, sql: "0123456789" }, token),
    ctx("proj"),
    {
      initSystemDb: async () => undefined,
      loadProjectForPush: async () => ({
        id: TENANT_PROJECT_ID,
        mode: "v2_shared",
        jwtSecret: JWT_SECRET,
      }),
      executePooledPush: async () => undefined,
      maxSqlBytes: 5,
    },
  );
  assert.equal(res.status, 413);
  assert.equal(await readError(res), "sql exceeds maximum size");
});

test("v1_dedicated project returns 400 mode split", async () => {
  const token = await mintServiceRoleJwt("service_role");
  const res = await runPooledPushPost(
    pooledPushRequest({ hash: VALID_HASH, sql: "select 1" }, token),
    ctx("legacy"),
    {
      initSystemDb: async () => undefined,
      loadProjectForPush: async () => ({
        id: TENANT_PROJECT_ID,
        mode: "v1_dedicated",
        jwtSecret: JWT_SECRET,
      }),
      executePooledPush: async () => undefined,
    },
  );
  assert.equal(res.status, 400);
  assert.match(await readError(res), /v1_dedicated/);
});

test("JWT with wrong role returns 403", async () => {
  const token = await mintServiceRoleJwt("authenticated");
  const res = await runPooledPushPost(
    pooledPushRequest({ hash: VALID_HASH, sql: "select 1" }, token),
    ctx("proj"),
    {
      initSystemDb: async () => undefined,
      loadProjectForPush: async () => ({
        id: TENANT_PROJECT_ID,
        mode: "v2_shared",
        jwtSecret: JWT_SECRET,
      }),
      executePooledPush: async () => undefined,
    },
  );
  assert.equal(res.status, 403);
  assert.match(await readError(res), /service_role/);
});

test("invalid JWT secret returns 401", async () => {
  const token = await new SignJWT({ role: "service_role" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode("wrong-secret-not-matching-db-32b"));

  const res = await runPooledPushPost(
    pooledPushRequest({ hash: VALID_HASH, sql: "select 1" }, token),
    ctx("proj"),
    {
      initSystemDb: async () => undefined,
      loadProjectForPush: async () => ({
        id: TENANT_PROJECT_ID,
        mode: "v2_shared",
        jwtSecret: JWT_SECRET,
      }),
      executePooledPush: async () => undefined,
    },
  );
  assert.equal(res.status, 401);
  assert.equal(await readError(res), "Invalid or expired token");
});

test("project not found returns 404", async () => {
  const token = await mintServiceRoleJwt("service_role");
  const res = await runPooledPushPost(
    pooledPushRequest({ hash: VALID_HASH, sql: "select 1" }, token),
    ctx("unknown-slug"),
    {
      initSystemDb: async () => undefined,
      loadProjectForPush: async () => null,
      executePooledPush: async () => undefined,
    },
  );
  assert.equal(res.status, 404);
});

test("v2_shared without jwt_secret returns 503", async () => {
  const res = await runPooledPushPost(
    pooledPushRequest(
      { hash: VALID_HASH, sql: "select 1" },
      await mintServiceRoleJwt("service_role"),
    ),
    ctx("proj"),
    {
      initSystemDb: async () => undefined,
      loadProjectForPush: async () => ({
        id: TENANT_PROJECT_ID,
        mode: "v2_shared",
        jwtSecret: null,
      }),
      executePooledPush: async () => undefined,
    },
  );
  assert.equal(res.status, 503);
  assert.match(await readError(res), /jwt_secret/);
});

test("successful v2_shared dispatch invokes executePooledPush with tenant schema", async () => {
  let executed: ExecutePushInput | undefined;
  const token = await mintServiceRoleJwt("service_role");
  const res = await runPooledPushPost(
    pooledPushRequest({ hash: VALID_HASH, sql: "select 2" }, token),
    ctx("my-proj"),
    {
      initSystemDb: async () => undefined,
      loadProjectForPush: async () => ({
        id: TENANT_PROJECT_ID,
        mode: "v2_shared",
        jwtSecret: JWT_SECRET,
      }),
      executePooledPush: async (input) => {
        executed = input;
      },
    },
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, schema: EXPECTED_SCHEMA });
  assert.deepEqual(executed, { schema: EXPECTED_SCHEMA, sql: "select 2" });
});

test("invalid JSON body returns 400", async () => {
  const headers = new Headers({ "content-type": "application/json" });
  headers.set("authorization", `Bearer ${await mintServiceRoleJwt("service_role")}`);
  const req = new NextRequest("http://test.local/api/projects/push", {
    method: "POST",
    headers,
    body: "{ not-json",
  });
  const res = await runPooledPushPost(req, ctx("proj"), {
    initSystemDb: async () => undefined,
    loadProjectForPush: async () => null,
    executePooledPush: async () => undefined,
  });
  assert.equal(res.status, 400);
  assert.equal(await readError(res), "Invalid JSON body");
});

test("Postgres-shaped errors map to 400 with sqlState", async () => {
  const token = await mintServiceRoleJwt("service_role");
  const err = Object.assign(new Error('relation "nope" does not exist'), {
    code: "42P01",
    position: "8",
  });
  const res = await runPooledPushPost(
    pooledPushRequest({ hash: VALID_HASH, sql: "select * from nope" }, token),
    ctx("proj"),
    {
      initSystemDb: async () => undefined,
      loadProjectForPush: async () => ({
        id: TENANT_PROJECT_ID,
        mode: "v2_shared",
        jwtSecret: JWT_SECRET,
      }),
      executePooledPush: async () => {
        throw err;
      },
    },
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string; sqlState?: string };
  assert.equal(body.sqlState, "42P01");
  assert.match(body.error, /nope/);
});

test("push timeout message maps to 504", async () => {
  const token = await mintServiceRoleJwt("service_role");
  const res = await runPooledPushPost(
    pooledPushRequest({ hash: VALID_HASH, sql: "select 1" }, token),
    ctx("proj"),
    {
      initSystemDb: async () => undefined,
      loadProjectForPush: async () => ({
        id: TENANT_PROJECT_ID,
        mode: "v2_shared",
        jwtSecret: JWT_SECRET,
      }),
      executePooledPush: async () => {
        throw new Error("SQL push exceeded 30s timeout");
      },
    },
  );
  assert.equal(res.status, 504);
});

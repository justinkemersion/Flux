import assert from "node:assert/strict";
import test from "node:test";
import { probeUnauthenticatedAccessIsInert } from "./api-probe";
import type { ApiProbeContext } from "./api-probe";

const BASE: ApiProbeContext = {
  apiUrl: "https://api.example.test",
  apiSchema: "api",
  mode: "v1_dedicated",
  hash: "abc1234",
};

test("unauthenticated canary accepts dedicated RLS filtering plus rejected writes", async (t) => {
  const responses = [
    new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    Response.json({ code: "42501" }, { status: 403 }),
  ];
  t.mock.method(globalThis, "fetch", async () => responses.shift()!);

  const result = await probeUnauthenticatedAccessIsInert(BASE, 42);
  assert.deepEqual(result, { readStatus: 200, writeStatus: 403 });
});

test("unauthenticated canary accepts v2 gateway rejection", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "authorization required" }, { status: 401 }),
  );

  const result = await probeUnauthenticatedAccessIsInert(
    { ...BASE, mode: "v2_shared", apiSchema: "t_abc123_api" },
    42,
  );
  assert.deepEqual(result, { readStatus: 401, writeStatus: 401 });
});

test("unauthenticated canary rejects a visible known row", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json([{ id: 42 }]));

  await assert.rejects(
    probeUnauthenticatedAccessIsInert(BASE, 42),
    /Unauthenticated GET exposed known row/u,
  );
});

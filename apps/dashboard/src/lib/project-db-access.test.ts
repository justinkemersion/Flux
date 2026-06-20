import test from "node:test";
import assert from "node:assert/strict";
import {
  getProjectDbAccessPlan,
  isProjectOwnerOrAdmin,
} from "./project-db-access.ts";

const ROW = {
  id: "5ecfa3ab-72d1-4b3a-9c8e-111111111111",
  slug: "yeastcoast",
  hash: "ffca33f",
  mode: "v1_dedicated" as const,
  apiSchemaName: null,
  apiSchemaStrategy: null,
  userId: "user-1",
};

test("getProjectDbAccessPlan returns redacted v1 plan for owner", async () => {
  const result = await getProjectDbAccessPlan(
    { hash: "ffca33f", actorUserId: "user-1" },
    {
      findOwnedProject: async () => ROW,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.plan.mode, "v1_dedicated");
  const json = JSON.stringify(result.plan);
  assert.doesNotMatch(json, /postgresql:\/\/|postgresConnectionString|jwtSecret|serviceRoleKey/i);
  assert.equal(result.plan.capabilities.tunnel, true);
});

test("getProjectDbAccessPlan returns v2 supported plan", async () => {
  const result = await getProjectDbAccessPlan(
    { hash: "ffca33f", actorUserId: "user-1" },
    {
      findOwnedProject: async () => ({ ...ROW, mode: "v2_shared" }),
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.plan.mode, "v2_shared");
  if (result.plan.mode !== "v2_shared") return;
  assert.equal(result.plan.supported, true);
  assert.equal(result.plan.capabilities.tunnel, true);
  assert.equal(result.plan.capabilities.temporaryCredentials, true);
});

test("getProjectDbAccessPlan blocks wrong user", async () => {
  const result = await getProjectDbAccessPlan(
    { hash: "ffca33f", actorUserId: "other-user" },
    {
      findOwnedProject: async () => null,
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 404);
});

test("isProjectOwnerOrAdmin allows owner", () => {
  assert.equal(isProjectOwnerOrAdmin(ROW, "user-1"), true);
});

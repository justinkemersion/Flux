import test from "node:test";
import assert from "node:assert/strict";
import { createProjectDbTempCredential } from "./project-db-temp-credentials.ts";

const ROW = {
  id: "5ecfa3ab-72d1-4b3a-9c8e-111111111111",
  slug: "yeastcoast",
  hash: "ffca33f",
  mode: "v2_shared" as const,
  apiSchemaName: null,
  apiSchemaStrategy: null,
  userId: "user-1",
};

test("createProjectDbTempCredential rejects v1 projects", async () => {
  const result = await createProjectDbTempCredential(
    { hash: "ffca33f", actorUserId: "user-1" },
    {
      findOwnedProject: async () => ({ ...ROW, mode: "v1_dedicated" }),
      insertAuditEvent: async () => {},
      insertTempCredential: async () => {},
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 400);
});

test("createProjectDbTempCredential rejects readwrite when disabled", async () => {
  const prev = process.env.FLUX_DB_ACCESS_ALLOW_READWRITE;
  delete process.env.FLUX_DB_ACCESS_ALLOW_READWRITE;
  try {
    const result = await createProjectDbTempCredential(
      { hash: "ffca33f", actorUserId: "user-1", access: "readwrite" },
      {
        findOwnedProject: async () => ROW,
        insertAuditEvent: async () => {},
        insertTempCredential: async () => {},
      },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 403);
  } finally {
    if (prev === undefined) delete process.env.FLUX_DB_ACCESS_ALLOW_READWRITE;
    else process.env.FLUX_DB_ACCESS_ALLOW_READWRITE = prev;
  }
});

test("createProjectDbTempCredential returns credential once without persisting password", async () => {
  const auditEvents: Array<{ username: string; ttlSeconds: number }> = [];
  const tempRows: Array<{ username: string }> = [];

  const result = await createProjectDbTempCredential(
    { hash: "ffca33f", actorUserId: "user-1", ttlSeconds: 900 },
    {
      findOwnedProject: async () => ROW,
      insertAuditEvent: async (event) => {
        auditEvents.push(event);
      },
      insertTempCredential: async (row) => {
        tempRows.push(row);
      },
      provisionRole: async () => ({ username: "flux_temp_ro_ffca33f_a1b2c3d4" }),
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.credential.username, "flux_temp_ro_ffca33f_a1b2c3d4");
  assert.match(result.credential.password, /^[A-Za-z0-9_-]+$/);
  assert.equal(result.credential.access, "readonly");
  assert.equal(result.credential.tenantSchema, "t_5ecfa3ab72d1_api");
  assert.equal(auditEvents.length, 1);
  assert.equal(tempRows.length, 1);
  assert.equal(JSON.stringify(auditEvents).includes(result.credential.password), false);
});

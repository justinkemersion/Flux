import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOffsiteObjectKey,
  formatOffsiteR2Status,
} from "./object-key.js";

test("buildOffsiteObjectKey v1 dedicated", () => {
  const key = buildOffsiteObjectKey({
    prefix: "prod",
    kind: "project_db",
    projectHash: "0a1b2c3",
    tenantId: "00000000-0000-0000-0000-000000000001",
    backupId: "11111111-2222-3333-4444-555555555555",
  });
  assert.equal(
    key,
    "prod/flux/v1/0a1b2c3/11111111-2222-3333-4444-555555555555.dump",
  );
});

test("buildOffsiteObjectKey v2 tenant export", () => {
  const tenantId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  const backupId = "22222222-3333-4444-5555-666666666666";
  const key = buildOffsiteObjectKey({
    prefix: "prod/",
    kind: "tenant_export",
    projectHash: "0a1b2c3",
    tenantId,
    backupId,
  });
  assert.equal(key, `prod/flux/v2/${tenantId}/${backupId}.dump`);
});

test("buildOffsiteObjectKey rejects empty backupId", () => {
  assert.throws(
    () =>
      buildOffsiteObjectKey({
        prefix: "prod",
        kind: "project_db",
        projectHash: "0a1b2c3",
        tenantId: "x",
        backupId: "  ",
      }),
    /backupId/,
  );
});

test("formatOffsiteR2Status mapping", () => {
  assert.equal(
    formatOffsiteR2Status({ r2Enabled: false, offsiteStatus: "complete" }),
    "disabled",
  );
  assert.equal(
    formatOffsiteR2Status({ r2Enabled: true, offsiteStatus: "complete" }),
    "uploaded",
  );
  assert.equal(
    formatOffsiteR2Status({ r2Enabled: true, offsiteStatus: "failed" }),
    "failed",
  );
  assert.equal(
    formatOffsiteR2Status({ r2Enabled: true, offsiteStatus: "pending" }),
    "missing",
  );
});

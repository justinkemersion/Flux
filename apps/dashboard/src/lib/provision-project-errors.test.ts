import test from "node:test";
import assert from "node:assert/strict";
import { TenantShortIdCollisionError } from "@flux/engine-v2";
import {
  mapProvisionProjectError,
  provisionProjectErrorBody,
} from "./provision-project-errors.ts";

test("TenantShortIdCollisionError maps to 409 with remediation code", () => {
  const err = new TenantShortIdCollisionError(
    "deadbeefcafe",
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  );
  const mapped = mapProvisionProjectError(err);
  assert.equal(mapped.status, 409);
  assert.equal(mapped.code, "tenant_short_id_collision");
  assert.equal(mapped.shortId, "deadbeefcafe");
  assert.match(mapped.message, /Retry create/i);

  const body = provisionProjectErrorBody(mapped);
  assert.equal(body.code, "tenant_short_id_collision");
  assert.equal(body.shortId, "deadbeefcafe");
});

test("invalid project name maps to 400", () => {
  const mapped = mapProvisionProjectError(new Error("Invalid project name: !!!"));
  assert.equal(mapped.status, 400);
  assert.equal(mapped.code, undefined);
});

test("unknown errors map to 500", () => {
  const mapped = mapProvisionProjectError(new Error("docker socket unavailable"));
  assert.equal(mapped.status, 500);
  assert.equal(mapped.message, "docker socket unavailable");
});

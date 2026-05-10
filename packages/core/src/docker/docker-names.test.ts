import test from "node:test";
import assert from "node:assert/strict";
import {
  fluxTenantStackBaseId,
  postgresContainerName,
  postgrestContainerName,
  tenantVolumeName,
} from "./docker-names.ts";

test("fluxTenantStackBaseId uses hash and slug", () => {
  assert.equal(fluxTenantStackBaseId("abc1234", "my-app"), "flux-abc1234-my-app");
});

test("container and volume names derive from stack base id", () => {
  const h = "ffca33f";
  const s = "yeastcoast";
  assert.equal(postgresContainerName(h, s), "flux-ffca33f-yeastcoast-db");
  assert.equal(postgrestContainerName(h, s), "flux-ffca33f-yeastcoast-api");
  assert.equal(tenantVolumeName(h, s), "flux-ffca33f-yeastcoast-db-data");
});

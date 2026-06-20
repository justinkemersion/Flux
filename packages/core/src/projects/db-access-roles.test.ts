import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPgRoleNameByteLength,
  fluxTempLoginRoleName,
  fluxTenantGroupRoleName,
  normalizeDbAccessTtlSeconds,
} from "./db-access-roles.ts";

test("fluxTenantGroupRoleName stays within 63 bytes", () => {
  const name = fluxTenantGroupRoleName("ffca33f", "readonly");
  assert.equal(name, "flux_tenant_ffca33f_ro");
  assert.doesNotThrow(() => assertPgRoleNameByteLength(name));
});

test("fluxTempLoginRoleName stays within 63 bytes", () => {
  const name = fluxTempLoginRoleName("ffca33f", "readonly", "a1b2c3d4");
  assert.match(name, /^flux_temp_ro_ffca33f_a1b2c3d4$/);
});

test("normalizeDbAccessTtlSeconds enforces max 8h", () => {
  assert.throws(
    () =>
      normalizeDbAccessTtlSeconds({
        access: "readonly",
        ttlSeconds: 60 * 60 * 9,
      }),
    /8 hours/,
  );
});

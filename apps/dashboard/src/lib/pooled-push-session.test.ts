import test from "node:test";
import assert from "node:assert/strict";
import {
  assertTenantRoleName,
  rejectPooledPushPrivilegeEscape,
} from "./pooled-push-session";

test("rejectPooledPushPrivilegeEscape blocks SET ROLE variants", () => {
  assert.throws(
    () => rejectPooledPushPrivilegeEscape("SET ROLE postgres;"),
    /privilege escalation/,
  );
  assert.throws(
    () => rejectPooledPushPrivilegeEscape("set local role superuser;"),
    /privilege escalation/,
  );
  assert.throws(
    () => rejectPooledPushPrivilegeEscape("RESET ROLE;"),
    /privilege escalation/,
  );
});

test("rejectPooledPushPrivilegeEscape allows normal DDL", () => {
  assert.doesNotThrow(() =>
    rejectPooledPushPrivilegeEscape(
      'CREATE TABLE "t_aabbccddeeff_api".items (id int);',
    ),
  );
});

test("assertTenantRoleName rejects malformed roles", () => {
  assert.throws(() => assertTenantRoleName("postgres"), /malformed/);
  assert.doesNotThrow(() => assertTenantRoleName("t_aabbccddeeff_role"));
});

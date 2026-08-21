import assert from "node:assert/strict";
import test from "node:test";
import { buildDedicatedRlsDoctorCheck } from "./project-doctor";
import type { ExposedTableSecurityFact } from "@flux/core";

function fact(
  overrides: Partial<ExposedTableSecurityFact> & Pick<ExposedTableSecurityFact, "table">,
): ExposedTableSecurityFact {
  return {
    schema: "api",
    rlsEnabled: true,
    policyCount: 1,
    privileges: [],
    ...overrides,
  };
}

test("dedicated doctor fails for issue #8 unrestricted-write exposure", () => {
  const check = buildDedicatedRlsDoctorCheck([
    fact({
      table: "mail_categories",
      rlsEnabled: false,
      policyCount: 0,
      privileges: [
        { role: "anon", privilege: "INSERT", sources: ["direct"] },
        { role: "anon", privilege: "UPDATE", sources: ["direct"] },
        { role: "anon", privilege: "DELETE", sources: ["direct"] },
        { role: "authenticated", privilege: "INSERT", sources: ["direct"] },
      ],
    }),
  ]);
  assert.equal(check.status, "fail");
  assert.match(check.detail, /mail_categories/u);
  assert.match(check.detail, /anon/u);
  assert.match(check.detail, /INSERT/u);
  assert.match(check.remediation ?? "", /revoke INSERT\/UPDATE\/DELETE\/TRUNCATE/u);
});

test("dedicated doctor warns for RLS-disabled read-only exposure", () => {
  const check = buildDedicatedRlsDoctorCheck([
    fact({
      table: "public_copy",
      rlsEnabled: false,
      privileges: [{ role: "anon", privilege: "SELECT", sources: ["direct"] }],
    }),
  ]);
  assert.equal(check.status, "warn");
  assert.match(check.detail, /public_copy/u);
});

test("dedicated doctor warns for RLS-enabled tables without policies", () => {
  const check = buildDedicatedRlsDoctorCheck([
    fact({
      table: "messages",
      rlsEnabled: true,
      policyCount: 0,
    }),
  ]);
  assert.equal(check.status, "warn");
  assert.match(check.detail, /no policies/u);
});

test("dedicated doctor passes when all exposed tables have RLS policies", () => {
  const check = buildDedicatedRlsDoctorCheck([
    fact({ table: "messages", rlsEnabled: true, policyCount: 2 }),
  ]);
  assert.equal(check.status, "pass");
});

test("dedicated doctor does not fail an ungranted internal table", () => {
  const check = buildDedicatedRlsDoctorCheck([
    fact({
      table: "internal_queue",
      rlsEnabled: false,
      policyCount: 0,
      privileges: [],
    }),
  ]);
  assert.equal(check.status, "warn");
  assert.notEqual(check.status, "fail");
});

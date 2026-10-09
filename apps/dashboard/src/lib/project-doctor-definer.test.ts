import assert from "node:assert/strict";
import test from "node:test";
import type { BlindedSecurityDefinerFinding } from "@flux/core/tenant-rls-invariants";
import { buildBlindedDefinerDoctorCheck } from "./project-doctor";

function finding(
  overrides: Partial<BlindedSecurityDefinerFinding> = {},
): BlindedSecurityDefinerFinding {
  return {
    schema: "t_aabbccddeeff_api",
    functionName: "read_members",
    identityArgs: "",
    ownerRole: "t_aabbccddeeff_ddl",
    tableSchema: "t_aabbccddeeff_api",
    tableName: "members",
    ...overrides,
  };
}

test("doctor fails a SECURITY DEFINER helper blinded by FORCE RLS", () => {
  const check = buildBlindedDefinerDoctorCheck([finding()]);
  assert.equal(check.status, "fail");
  assert.match(check.detail, /read_members\(\)/);
  assert.match(check.detail, /t_aabbccddeeff_ddl/);
  assert.match(check.detail, /members/);
  assert.match(check.remediation ?? "", /BYPASSRLS/);
  assert.match(check.remediation ?? "", /FORCE ROW LEVEL SECURITY/);
  assert.match(check.remediation ?? "", /dynamic SQL/i);
  assert.doesNotMatch(check.detail, /prosrc|SELECT \*/);
});

test("doctor passes when the catalog audit returns no findings", () => {
  const check = buildBlindedDefinerDoctorCheck([]);
  assert.equal(check.status, "pass");
  assert.match(check.detail, /No SECURITY DEFINER/);
  assert.equal(check.remediation, undefined);
});

test("doctor names only the findings the audit returned", () => {
  const check = buildBlindedDefinerDoctorCheck([
    finding({ functionName: "read_members_definer" }),
  ]);
  assert.equal(check.status, "fail");
  assert.match(check.detail, /read_members_definer/);
  assert.doesNotMatch(check.detail, /read_members_invoker/);
});

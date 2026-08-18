import assert from "node:assert/strict";
import test from "node:test";
import type { InspectedTable } from "@flux/core/schema-inspection";
import { buildDedicatedRlsDoctorCheck } from "./project-doctor";

function table(
  name: string,
  enabled: boolean,
  policyCount: number,
): InspectedTable {
  return {
    schema: "api",
    name,
    columns: [],
    primaryKey: [],
    foreignKeys: [],
    rls: { enabled, forced: false, policyCount },
  };
}

test("dedicated doctor fails for RLS-disabled API tables", () => {
  const check = buildDedicatedRlsDoctorCheck([table("messages", false, 0)]);
  assert.equal(check.status, "fail");
  assert.match(check.detail, /RLS disabled: messages/u);
});

test("dedicated doctor fails for RLS-enabled tables without policies", () => {
  const check = buildDedicatedRlsDoctorCheck([table("messages", true, 0)]);
  assert.equal(check.status, "fail");
  assert.match(check.detail, /no policies: messages/u);
});

test("dedicated doctor passes when all exposed tables have RLS policies", () => {
  const check = buildDedicatedRlsDoctorCheck([table("messages", true, 2)]);
  assert.equal(check.status, "pass");
});

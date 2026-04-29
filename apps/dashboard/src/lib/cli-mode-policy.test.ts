import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultModeForPlan,
  resolveCreateModeForPlan,
} from "./cli-mode-policy";

test("defaultModeForPlan maps hobby to v2_shared", () => {
  assert.equal(defaultModeForPlan("hobby"), "v2_shared");
});

test("defaultModeForPlan maps pro to v2_shared (Standard default)", () => {
  assert.equal(defaultModeForPlan("pro"), "v2_shared");
});

test("resolveCreateModeForPlan rejects dedicated mode on hobby", () => {
  const result = resolveCreateModeForPlan({
    requestedMode: "v1_dedicated",
    plan: "hobby",
  });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("Expected policy rejection");
  assert.match(result.message, /Pro subscription/);
});

test("resolveCreateModeForPlan allows explicit mode when entitled", () => {
  const result = resolveCreateModeForPlan({
    requestedMode: "v2_shared",
    plan: "pro",
  });
  assert.deepEqual(result, { ok: true, mode: "v2_shared" });
});

test("resolveCreateModeForPlan defaults omitted mode to v2_shared on pro", () => {
  const result = resolveCreateModeForPlan({ plan: "pro" });
  assert.deepEqual(result, { ok: true, mode: "v2_shared" });
});

test("resolveCreateModeForPlan allows v1_dedicated when pro requests it", () => {
  const result = resolveCreateModeForPlan({
    requestedMode: "v1_dedicated",
    plan: "pro",
  });
  assert.deepEqual(result, { ok: true, mode: "v1_dedicated" });
});

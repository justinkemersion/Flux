import test from "node:test";
import assert from "node:assert/strict";
import {
  assertWithinProjectLimit,
  parseOptionalMode,
  parseOptionalStripSupabase,
  resolveCreateModeForPlan,
  slugifyProjectName,
} from "./cli-project-provision";

test("parseOptionalMode accepts v2_shared and v1_dedicated", () => {
  assert.equal(parseOptionalMode({ mode: "v2_shared" }), "v2_shared");
  assert.equal(parseOptionalMode({ mode: "v1_dedicated" }), "v1_dedicated");
  assert.equal(parseOptionalMode({}), undefined);
  assert.equal(parseOptionalMode({ mode: "bad" }), "invalid");
});

test("parseOptionalStripSupabase reads boolean when present", () => {
  assert.equal(parseOptionalStripSupabase({ stripSupabaseRestPrefix: false }), false);
  assert.equal(parseOptionalStripSupabase({}), undefined);
});

test("slugifyProjectName normalizes vessel-ledger unchanged", () => {
  assert.equal(slugifyProjectName("vessel-ledger"), "vessel-ledger");
});

test("init slug body must match slugify output", () => {
  const raw = "My App";
  const normalized = slugifyProjectName(raw);
  assert.notEqual(raw, normalized);
  assert.equal(normalized, "my-app");
});

test("resolveCreateModeForPlan defaults hobby init create to v2_shared", () => {
  const result = resolveCreateModeForPlan({ plan: "hobby" });
  assert.deepEqual(result, { ok: true, mode: "v2_shared" });
});

test("assertWithinProjectLimit blocks hobby at cap", () => {
  const result = assertWithinProjectLimit("hobby", 2);
  assert.equal(result.ok, false);
});

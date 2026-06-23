import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertWithinActiveProjectLimit,
  lifecycleStateForAction,
  lifecycleStateLabel,
  normalizeProjectLifecycleState,
} from "./project-lifecycle-state.ts";

test("normalizeProjectLifecycleState defaults unknown to active", () => {
  assert.equal(normalizeProjectLifecycleState(null), "active");
  assert.equal(normalizeProjectLifecycleState("nope"), "active");
  assert.equal(normalizeProjectLifecycleState("dormant"), "dormant");
});

test("lifecycleStateForAction maps product verbs", () => {
  assert.equal(lifecycleStateForAction("wake"), "active");
  assert.equal(lifecycleStateForAction("sleep"), "dormant");
  assert.equal(lifecycleStateForAction("archive"), "archived");
});

test("assertWithinActiveProjectLimit blocks hobby at cap", () => {
  const result = assertWithinActiveProjectLimit("hobby", 2);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /Active project limit/i);
  }
});

test("assertWithinActiveProjectLimit allows unlimited admin bypass", () => {
  assert.deepEqual(
    assertWithinActiveProjectLimit("hobby", 99, { unlimited: true }),
    { ok: true },
  );
});

test("lifecycleStateLabel uses product terms", () => {
  assert.equal(lifecycleStateLabel("active"), "Active");
  assert.equal(lifecycleStateLabel("dormant"), "Dormant");
  assert.equal(lifecycleStateLabel("archived"), "Archived");
});

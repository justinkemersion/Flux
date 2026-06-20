import assert from "node:assert/strict";
import test from "node:test";
import { isGauntletSlug } from "./names";

test("cleanup safety: slug must match gauntlet marker", () => {
  assert.equal(isGauntletSlug("gauntlet-1718841600-a1b2c3"), true);
  assert.equal(isGauntletSlug("production-app"), false);
});

test("cleanup safety: custom prefix must match", () => {
  assert.equal(isGauntletSlug("ci-1718841600-ab12cd", "ci"), true);
  assert.equal(isGauntletSlug("ci-1718841600-ab12cd", "gauntlet"), false);
});

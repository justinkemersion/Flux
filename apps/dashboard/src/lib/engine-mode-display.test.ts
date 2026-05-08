import test from "node:test";
import assert from "node:assert/strict";
import {
  engineModeAriaLabel,
  engineModeShortLabel,
  engineModeTooltip,
  resolveEngineMode,
} from "./engine-mode-display.ts";

test("resolveEngineMode defaults missing to v1_dedicated", () => {
  assert.equal(resolveEngineMode(undefined), "v1_dedicated");
  assert.equal(resolveEngineMode(null), "v1_dedicated");
});

test("engineModeShortLabel uses Pooled and Dedicated", () => {
  assert.equal(engineModeShortLabel("v2_shared"), "Pooled");
  assert.equal(engineModeShortLabel("v1_dedicated"), "Dedicated");
  assert.equal(engineModeShortLabel(undefined), "Dedicated");
});

test("engineModeTooltip mentions internal engine names", () => {
  assert.match(engineModeTooltip("v2_shared"), /v2 shared/i);
  assert.match(engineModeTooltip("v1_dedicated"), /v1 dedicated/i);
});

test("engineModeAriaLabel prefixes Deployment", () => {
  assert.equal(engineModeAriaLabel("v2_shared"), "Deployment: Pooled");
});

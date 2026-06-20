import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_GAUNTLET_PREFIX,
  generateGauntletProjectName,
  isGauntletSlug,
} from "./names";

test("generateGauntletProjectName uses prefix and random suffix", () => {
  const name = generateGauntletProjectName("gauntlet");
  assert.match(name, /^gauntlet-\d+-[a-f0-9]{6}$/u);
});

test("generateGauntletProjectName defaults prefix to gauntlet", () => {
  const name = generateGauntletProjectName();
  assert.ok(name.startsWith(`${DEFAULT_GAUNTLET_PREFIX}-`));
});

test("isGauntletSlug accepts slugs matching gauntlet pattern", () => {
  assert.equal(isGauntletSlug("gauntlet-1718841600-a1b2c3"), true);
  assert.equal(isGauntletSlug("custom-1718841600-deadbe", "custom"), true);
});

test("isGauntletSlug rejects non-gauntlet slugs", () => {
  assert.equal(isGauntletSlug("my-app-prod"), false);
  assert.equal(isGauntletSlug("gauntlet-not-a-marker"), false);
  assert.equal(isGauntletSlug("other-1718841600-abcd12", "gauntlet"), false);
});

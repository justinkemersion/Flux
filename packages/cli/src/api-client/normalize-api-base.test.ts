import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFluxApiBase } from "./normalize-api-base.ts";

test("normalizeFluxApiBase appends /api when missing", () => {
  assert.equal(
    normalizeFluxApiBase("https://flux.vsl-base.com"),
    "https://flux.vsl-base.com/api",
  );
});

test("normalizeFluxApiBase preserves single /api suffix", () => {
  assert.equal(
    normalizeFluxApiBase("https://flux.vsl-base.com/api"),
    "https://flux.vsl-base.com/api",
  );
});

test("normalizeFluxApiBase strips duplicate /api/api suffix", () => {
  assert.equal(
    normalizeFluxApiBase("https://flux.vsl-base.com/api/api"),
    "https://flux.vsl-base.com/api",
  );
});

test("normalizeFluxApiBase trims trailing slashes before normalizing", () => {
  assert.equal(
    normalizeFluxApiBase("https://flux.vsl-base.com/"),
    "https://flux.vsl-base.com/api",
  );
  assert.equal(
    normalizeFluxApiBase("https://flux.vsl-base.com/api/"),
    "https://flux.vsl-base.com/api",
  );
});

test("normalizeFluxApiBase rejects empty input", () => {
  assert.throws(() => normalizeFluxApiBase(""), /non-empty/);
  assert.throws(() => normalizeFluxApiBase("   "), /non-empty/);
});

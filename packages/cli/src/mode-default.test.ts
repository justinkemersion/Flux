import test from "node:test";
import assert from "node:assert/strict";
import { resolveExplicitCreateMode } from "./mode-default";

test("explicit --mode wins over env", () => {
  const mode = resolveExplicitCreateMode({
    explicitMode: "v2_shared",
    envMode: "v1_dedicated",
  });
  assert.equal(mode, "v2_shared");
});

test("FLUX_DEFAULT_MODE used when --mode omitted", () => {
  const mode = resolveExplicitCreateMode({
    explicitMode: undefined,
    envMode: "v1_dedicated",
  });
  assert.equal(mode, "v1_dedicated");
});

test("returns undefined when neither set (server chooses)", () => {
  const mode = resolveExplicitCreateMode({
    explicitMode: undefined,
    envMode: undefined,
  });
  assert.equal(mode, undefined);
});

test("invalid explicit mode throws", () => {
  assert.throws(
    () =>
      resolveExplicitCreateMode({
        explicitMode: "bad-mode",
        envMode: undefined,
      }),
    /Invalid --mode/,
  );
});

test("invalid env mode throws", () => {
  assert.throws(
    () =>
      resolveExplicitCreateMode({
        explicitMode: undefined,
        envMode: "not-a-mode",
      }),
    /Invalid FLUX_DEFAULT_MODE/,
  );
});

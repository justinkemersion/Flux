import test from "node:test";
import assert from "node:assert/strict";
import { resolveCreateModeFromInputs } from "./mode-default";

test("create mode precedence: explicit --mode wins", () => {
  const mode = resolveCreateModeFromInputs({
    explicitMode: "v2_shared",
    envMode: "v1_dedicated",
    profileDefaultMode: "v1_dedicated",
  });
  assert.equal(mode, "v2_shared");
});

test("create mode precedence: env override beats profile", () => {
  const mode = resolveCreateModeFromInputs({
    explicitMode: undefined,
    envMode: "v2_shared",
    profileDefaultMode: "v1_dedicated",
  });
  assert.equal(mode, "v2_shared");
});

test("create mode precedence: profile default beats hard fallback", () => {
  const mode = resolveCreateModeFromInputs({
    explicitMode: undefined,
    envMode: undefined,
    profileDefaultMode: "v1_dedicated",
  });
  assert.equal(mode, "v1_dedicated");
});

test("create mode fallback: v2_shared when nothing set", () => {
  const mode = resolveCreateModeFromInputs({
    explicitMode: undefined,
    envMode: undefined,
    profileDefaultMode: undefined,
  });
  assert.equal(mode, "v2_shared");
});

test("invalid explicit mode throws", () => {
  assert.throws(
    () =>
      resolveCreateModeFromInputs({
        explicitMode: "bad-mode",
        envMode: undefined,
        profileDefaultMode: undefined,
      }),
    /Invalid --mode/,
  );
});

test("invalid env mode throws", () => {
  assert.throws(
    () =>
      resolveCreateModeFromInputs({
        explicitMode: undefined,
        envMode: "not-a-mode",
        profileDefaultMode: undefined,
      }),
    /Invalid FLUX_DEFAULT_MODE/,
  );
});

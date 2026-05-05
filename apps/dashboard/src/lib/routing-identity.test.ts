import test from "node:test";
import assert from "node:assert/strict";
import { projectApiInterface } from "./routing-identity.ts";

test("projectApiInterface returns flattened host for v2_shared", () => {
  assert.equal(
    projectApiInterface("my-app", "abc1234", "v2_shared"),
    "api--my-app--abc1234.vsl-base.com",
  );
});

test("projectApiInterface returns flattened host for v1_dedicated", () => {
  assert.equal(
    projectApiInterface("my-app", "abc1234", "v1_dedicated"),
    "api--my-app--abc1234.vsl-base.com",
  );
});

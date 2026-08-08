import test from "node:test";
import assert from "node:assert/strict";
import { resolveDocPageFile } from "./docs-content-path";

test("resolveDocPageFile rejects path traversal slug segments", () => {
  const file = resolveDocPageFile("/repo", ["guides", "..", "..", "README"]);
  assert.equal(file, null);
});

test("resolveDocPageFile rejects dot-only segments", () => {
  const file = resolveDocPageFile("/repo", [".", "index"]);
  assert.equal(file, null);
});

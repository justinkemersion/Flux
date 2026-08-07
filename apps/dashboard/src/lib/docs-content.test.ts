import test from "node:test";
import assert from "node:assert/strict";
import { loadDocPage } from "./docs-content";

test("loadDocPage rejects path traversal slug segments", async () => {
  const page = await loadDocPage(["guides", "..", "..", "README"]);
  assert.equal(page, null);
});

test("loadDocPage rejects dot-only segments", async () => {
  const page = await loadDocPage([".", "index"]);
  assert.equal(page, null);
});

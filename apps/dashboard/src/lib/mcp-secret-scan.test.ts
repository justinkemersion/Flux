import test from "node:test";
import assert from "node:assert/strict";
import {
  containsObviousSecret,
  isSafeMcpKeyPreview,
  stringContainsMcpTokenMaterial,
} from "./mcp-secret-scan.ts";

const FULL_MCP =
  "flx_mcp_aabbccddeeff_0123456789abcdef0123_abcd";
const SAFE_PREVIEW = "flx_mcp_aabb…abcd";
const PARTIAL_MCP = "flx_mcp_aabbccddeeff_0123";

test("isSafeMcpKeyPreview allows dashboard display fragments", () => {
  assert.equal(isSafeMcpKeyPreview(SAFE_PREVIEW), true);
  assert.equal(isSafeMcpKeyPreview(FULL_MCP), false);
});

test("stringContainsMcpTokenMaterial detects full and partial MCP tokens", () => {
  assert.equal(stringContainsMcpTokenMaterial(FULL_MCP), true);
  assert.equal(stringContainsMcpTokenMaterial(PARTIAL_MCP), true);
  assert.equal(stringContainsMcpTokenMaterial(SAFE_PREVIEW), false);
});

test("stringContainsMcpTokenMaterial detects Bearer MCP authorization headers", () => {
  assert.equal(
    stringContainsMcpTokenMaterial(`Bearer ${FULL_MCP}`),
    true,
  );
});

test("containsObviousSecret rejects MCP tokens in request payloads", () => {
  assert.equal(
    containsObviousSecret({ authorization: `Bearer ${FULL_MCP}` }),
    true,
  );
  assert.equal(
    containsObviousSecret({ note: FULL_MCP }),
    true,
  );
});

test("containsObviousSecret allows safe keyPreview in metadata", () => {
  assert.equal(
    containsObviousSecret({ keyPreview: SAFE_PREVIEW }, "metadata"),
    false,
  );
  assert.equal(
    containsObviousSecret({ keyPreview: FULL_MCP }, "metadata"),
    true,
  );
});

test("containsObviousSecret still allows non-secret hash fields", () => {
  assert.equal(containsObviousSecret({ hash: "abc1234" }), false);
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { stringContainsMcpTokenMaterial } from "@flux/cli/api-client";

const README = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "README.md"),
  "utf8",
);

const FULL_MCP_TOKEN_RE =
  /\bflx_mcp_[a-f0-9]{12}_[a-f0-9]{20}_[a-f0-9]{4}\b/i;

test("README uses placeholder flx_mcp_ tokens only", () => {
  assert.match(README, /flx_mcp_\.\.\./);
  assert.equal(FULL_MCP_TOKEN_RE.test(README), false);
});

test("README documents FLUX_MCP_TOKEN as preferred MCP auth", () => {
  assert.match(README, /FLUX_MCP_TOKEN/);
  assert.match(README, /\/settings\/mcp-tokens/);
  const mcpIdx = README.indexOf("FLUX_MCP_TOKEN");
  const legacyIdx = README.indexOf("FLUX_API_TOKEN", mcpIdx);
  assert.ok(mcpIdx >= 0 && legacyIdx > mcpIdx, "FLUX_MCP_TOKEN should appear before legacy FLUX_API_TOKEN");
});

test("README legacy section marks FLUX_API_TOKEN temporary for MCP", () => {
  assert.match(README, /remains supported temporarily/i);
  assert.match(README, /legacyCliTokenForMcp:\s*supported_with_warning/);
  assert.doesNotMatch(README, /removed immediately/i);
});

test("README Cursor examples do not trip secret scanner", () => {
  const jsonBlocks = README.match(/```json[\s\S]*?```/g) ?? [];
  assert.ok(jsonBlocks.length >= 2);
  for (const block of jsonBlocks) {
    assert.equal(FULL_MCP_TOKEN_RE.test(block), false);
    if (block.includes("flx_mcp_")) {
      assert.match(block, /flx_mcp_\.\.\./);
    }
  }
  assert.equal(stringContainsMcpTokenMaterial("flx_mcp_..."), false);
});

test("README includes development pnpm start Cursor example", () => {
  assert.match(README, /"pnpm"/);
  assert.match(README, /@flux\/mcp/);
  assert.match(README, /"start"/);
});

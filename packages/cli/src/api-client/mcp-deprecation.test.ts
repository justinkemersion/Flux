import test from "node:test";
import assert from "node:assert/strict";
import { LEGACY_MCP_TOKEN_WARNING } from "./mcp-auth.ts";
import {
  MCP_LEGACY_CLI_TOKEN_DEPRECATION_PREREQUISITES,
  MCP_LEGACY_CLI_TOKEN_FOR_MCP_STATUS,
  buildMcpLegacyCliTokenWarning,
  legacyMcpWarningImpliesImmediateRemoval,
} from "./mcp-deprecation.ts";

test("legacy CLI token for MCP status is supported_with_warning", () => {
  assert.equal(MCP_LEGACY_CLI_TOKEN_FOR_MCP_STATUS, "supported_with_warning");
});

test("deprecation prerequisites mark docs and examples shipped in Slice G", () => {
  assert.equal(MCP_LEGACY_CLI_TOKEN_DEPRECATION_PREREQUISITES.hostedTokenUiDeployed, true);
  assert.equal(MCP_LEGACY_CLI_TOKEN_DEPRECATION_PREREQUISITES.docsPublished, true);
  assert.equal(MCP_LEGACY_CLI_TOKEN_DEPRECATION_PREREQUISITES.cursorExamplesPublished, true);
  assert.equal(MCP_LEGACY_CLI_TOKEN_DEPRECATION_PREREQUISITES.oneReleaseCycleElapsed, false);
});

test("legacy MCP warning does not imply immediate removal", () => {
  const warning = buildMcpLegacyCliTokenWarning();
  assert.equal(LEGACY_MCP_TOKEN_WARNING, warning);
  assert.match(warning, /remains supported temporarily/i);
  assert.match(warning, /FLUX_MCP_TOKEN/);
  assert.match(warning, /\/settings\/mcp-tokens/);
  assert.match(warning, /no hard removal date/i);
  assert.equal(legacyMcpWarningImpliesImmediateRemoval(warning), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { MCP_CAPABILITIES as CLI_CAPABILITIES } from "@flux/cli/api-client";
import { MCP_CAPABILITIES as CORE_CAPABILITIES } from "@flux/core/mcp-capabilities";

test("CLI and @flux/core MCP capability enums match", () => {
  assert.deepEqual([...CLI_CAPABILITIES].sort(), [...CORE_CAPABILITIES].sort());
});

/**
 * MCP tool → required capability mapping (derived from tool-manifest).
 */

import type { McpCapability } from "@flux/cli/api-client";
import { manifestRequiredCapabilities } from "./tool-manifest.js";

export const MCP_TOOL_REQUIRED_CAPABILITIES: Readonly<Record<string, McpCapability>> =
  manifestRequiredCapabilities();

export function requiredCapabilityForMcpTool(tool: string): McpCapability | null {
  return MCP_TOOL_REQUIRED_CAPABILITIES[tool] ?? null;
}

export const MCP_CAPABILITY_DENIED_GATE = "mcp_token_capability_denied";

export function mcpCapabilityDenialMessage(
  tool: string,
  requiredCapability: McpCapability,
): string {
  return `Tool ${tool} requires capability ${requiredCapability}.`;
}

export function mcpCapabilityDenialRemediation(
  requiredCapability: McpCapability,
): string {
  return `Create an MCP token with the "${requiredCapability}" capability at /settings/mcp-tokens.`;
}

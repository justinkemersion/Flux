/**
 * MCP-side capability defense-in-depth (Phase 5 Slice F).
 */

import { resolveMcpServerToken } from "@flux/cli/api-client";
import type { FluxToolClient } from "./tools";
import {
  MCP_CAPABILITY_DENIED_GATE,
  mcpCapabilityDenialMessage,
  mcpCapabilityDenialRemediation,
  requiredCapabilityForMcpTool,
} from "./mcp-tool-capabilities";
import { getMcpTokenProfile, tokenHasCapability } from "./mcp-token-profile";
import { fail, type ToolResult } from "./result";

export { resetMcpTokenProfileCache } from "./mcp-token-profile";
export { MCP_CAPABILITY_DENIED_GATE } from "./mcp-tool-capabilities";

export async function assertMcpToolCapabilityAllowed(
  tool: string,
  client: FluxToolClient,
): Promise<ToolResult | null> {
  const required = requiredCapabilityForMcpTool(tool);
  if (!required) {
    return null;
  }

  const resolved = resolveMcpServerToken();
  if (resolved.source !== "FLUX_MCP_TOKEN") {
    return null;
  }

  const profile = await getMcpTokenProfile(client);
  if (!profile) {
    return null;
  }

  if (!tokenHasCapability(profile, required)) {
    return fail(mcpCapabilityDenialMessage(tool, required), {
      remediation: mcpCapabilityDenialRemediation(required),
      data: {
        tool,
        requiredCapability: required,
        gate: MCP_CAPABILITY_DENIED_GATE,
      },
    });
  }

  return null;
}

export function denialContainsTokenSecret(
  result: ToolResult,
  token: string,
): boolean {
  const text = JSON.stringify(result);
  return token.length > 0 && text.includes(token);
}

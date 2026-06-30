/**
 * MCP tool → required capability mapping (Phase 5 Slice F).
 * Defense-in-depth before control-plane route enforcement.
 */

import type { McpCapability } from "@flux/cli/api-client";

export const MCP_TOOL_REQUIRED_CAPABILITIES: Readonly<Record<string, McpCapability>> = {
  "flux.project.list": "project:read",
  "flux.project.describe": "project:read",
  "flux.schema.inspect": "schema:read",
  "flux.schema.counts": "schema:read",
  "flux.migrations.list": "schema:read",
  "flux.doctor": "project:read",
  "flux.activity": "activity:read",
  "flux.backup.list": "backup:read",
  "flux.destructive.preflight": "backup:read",
  "flux.backup.ensureVerified": "backup:ensure_verified",
  "flux.migration.plan": "migration:plan",
  "flux.migration.apply": "migration:apply",
  "flux.credentials.temporary": "query:readonly",
  "flux.query.readonly": "query:readonly",
};

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

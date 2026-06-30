/**
 * Canonical MCP token capability enum (shared across dashboard, CLI, and MCP server).
 */

export const MCP_CAPABILITIES = [
  "project:read",
  "schema:read",
  "backup:read",
  "backup:ensure_verified",
  "migration:plan",
  "migration:apply",
  "query:readonly",
  "intent:read",
  "activity:read",
] as const;

export type McpCapability = (typeof MCP_CAPABILITIES)[number];

const MCP_CAPABILITY_SET = new Set<string>(MCP_CAPABILITIES);

export function isKnownMcpCapability(value: string): value is McpCapability {
  return MCP_CAPABILITY_SET.has(value);
}

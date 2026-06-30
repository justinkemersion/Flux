/** Scoped MCP token capabilities — kept in sync with dashboard `mcp-capabilities.ts`. */

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

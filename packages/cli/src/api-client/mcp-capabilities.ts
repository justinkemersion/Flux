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

/** Read-only observer — list/describe projects, schema, backups, intents, activity. */
export const MCP_CAPABILITY_PRESET_READ_ONLY_OBSERVER = [
  "project:read",
  "schema:read",
  "backup:read",
  "intent:read",
  "activity:read",
] as const satisfies readonly McpCapability[];

/** Schema inspector — same as read-only observer (includes `schema:read`). */
export const MCP_CAPABILITY_PRESET_SCHEMA_INSPECTOR =
  MCP_CAPABILITY_PRESET_READ_ONLY_OBSERVER;

/** Migration planner — observer + local plan (no apply). */
export const MCP_CAPABILITY_PRESET_MIGRATION_PLANNER = [
  ...MCP_CAPABILITY_PRESET_READ_ONLY_OBSERVER,
  "migration:plan",
] as const satisfies readonly McpCapability[];

/** Read-only data inspector — observer + bounded `flux.query.readonly`. */
export const MCP_CAPABILITY_PRESET_READ_ONLY_DATA_INSPECTOR = [
  ...MCP_CAPABILITY_PRESET_READ_ONLY_OBSERVER,
  "query:readonly",
] as const satisfies readonly McpCapability[];

/** Controlled migration applier — planner + verified backup + apply (shorter expiry). */
export const MCP_CAPABILITY_PRESET_CONTROLLED_MIGRATION_APPLIER = [
  ...MCP_CAPABILITY_PRESET_MIGRATION_PLANNER,
  "backup:ensure_verified",
  "migration:apply",
] as const satisfies readonly McpCapability[];

export const MCP_CAPABILITY_PRESETS = {
  readOnlyObserver: MCP_CAPABILITY_PRESET_READ_ONLY_OBSERVER,
  schemaInspector: MCP_CAPABILITY_PRESET_SCHEMA_INSPECTOR,
  migrationPlanner: MCP_CAPABILITY_PRESET_MIGRATION_PLANNER,
  readOnlyDataInspector: MCP_CAPABILITY_PRESET_READ_ONLY_DATA_INSPECTOR,
  controlledMigrationApplier: MCP_CAPABILITY_PRESET_CONTROLLED_MIGRATION_APPLIER,
} as const;

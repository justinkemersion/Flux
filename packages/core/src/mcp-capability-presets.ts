/**
 * MCP token capability presets (dashboard + CLI + docs).
 */

import { MCP_CAPABILITIES, type McpCapability } from "./mcp-capabilities.ts";

const READ_ONLY_OBSERVER = [
  "project:read",
  "schema:read",
  "backup:read",
  "intent:read",
  "activity:read",
] as const satisfies readonly McpCapability[];

const MIGRATION_PLANNER = [
  ...READ_ONLY_OBSERVER,
  "migration:plan",
] as const satisfies readonly McpCapability[];

const READ_ONLY_DATA_INSPECTOR = [
  ...READ_ONLY_OBSERVER,
  "query:readonly",
] as const satisfies readonly McpCapability[];

const CONTROLLED_MIGRATION_APPLIER = [
  ...MIGRATION_PLANNER,
  "backup:ensure_verified",
  "migration:apply",
] as const satisfies readonly McpCapability[];

export const MCP_CAPABILITY_PRESET_READ_ONLY_OBSERVER = READ_ONLY_OBSERVER;
export const MCP_CAPABILITY_PRESET_MIGRATION_PLANNER = MIGRATION_PLANNER;
export const MCP_CAPABILITY_PRESET_READ_ONLY_DATA_INSPECTOR = READ_ONLY_DATA_INSPECTOR;
export const MCP_CAPABILITY_PRESET_CONTROLLED_MIGRATION_APPLIER =
  CONTROLLED_MIGRATION_APPLIER;

export type McpCapabilityPresetId =
  | "readOnlyObserver"
  | "migrationPlanner"
  | "readOnlyDataInspector"
  | "controlledMigrationApplier";

export type McpCapabilityPresetDefinition = {
  id: McpCapabilityPresetId;
  label: string;
  description: string;
  /** Shown for controlled applier — do not use as default Cursor token. */
  cursorWarning?: string;
  capabilities: readonly McpCapability[];
  recommendedForCursor?: boolean;
};

export const MCP_CAPABILITY_PRESET_DEFINITIONS: readonly McpCapabilityPresetDefinition[] = [
  {
    id: "readOnlyObserver",
    label: "Read-only observer",
    description: "List projects, inspect schema, backups, and agent activity.",
    capabilities: READ_ONLY_OBSERVER,
    recommendedForCursor: true,
  },
  {
    id: "migrationPlanner",
    label: "Migration planner",
    description: "Observer plus flux.migration.plan — never applies SQL.",
    capabilities: MIGRATION_PLANNER,
    recommendedForCursor: true,
  },
  {
    id: "readOnlyDataInspector",
    label: "Read-only data inspector",
    description: "Observer plus bounded flux.query.readonly.",
    capabilities: READ_ONLY_DATA_INSPECTOR,
  },
  {
    id: "controlledMigrationApplier",
    label: "Controlled applier",
    description:
      "Can change project database schema after plan + backup gates.",
    cursorWarning: "Do not use as your default Cursor token.",
    capabilities: CONTROLLED_MIGRATION_APPLIER,
  },
] as const;

export const MCP_MIGRATION_APPLY_DOCTOR_WARNING_LINES = [
  "WARNING: This MCP token can apply migrations.",
  "Use a planner-only token for everyday Cursor sessions.",
] as const;

export function mcpTokenCanApplyMigrations(capabilities: readonly string[]): boolean {
  return capabilities.includes("migration:apply");
}

export function capabilitiesMatchPreset(
  capabilities: readonly string[],
  preset: readonly McpCapability[],
): boolean {
  if (capabilities.length !== preset.length) return false;
  const a = [...capabilities].sort();
  const b = [...preset].sort();
  return a.every((value, index) => value === b[index]);
}

export function resolveMcpCapabilityPresetId(
  capabilities: readonly string[],
): McpCapabilityPresetId | null {
  for (const preset of MCP_CAPABILITY_PRESET_DEFINITIONS) {
    if (capabilitiesMatchPreset(capabilities, preset.capabilities)) {
      return preset.id;
    }
  }
  return null;
}

/** Validate preset capabilities are a known subset of the enum. */
export function allMcpPresetsValid(): boolean {
  const allowed = new Set<string>(MCP_CAPABILITIES);
  return MCP_CAPABILITY_PRESET_DEFINITIONS.every((preset) =>
    preset.capabilities.every((cap) => allowed.has(cap)),
  );
}

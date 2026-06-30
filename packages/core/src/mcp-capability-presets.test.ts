import test from "node:test";
import assert from "node:assert/strict";
import {
  MCP_CAPABILITY_PRESET_MIGRATION_PLANNER,
  MCP_CAPABILITY_PRESET_CONTROLLED_MIGRATION_APPLIER,
  MCP_MIGRATION_APPLY_DOCTOR_WARNING_LINES,
  allMcpPresetsValid,
  capabilitiesMatchPreset,
  mcpTokenCanApplyMigrations,
  resolveMcpCapabilityPresetId,
} from "./mcp-capability-presets.ts";

test("all preset capabilities are known enum values", () => {
  assert.equal(allMcpPresetsValid(), true);
});

test("mcpTokenCanApplyMigrations is true only with migration:apply", () => {
  assert.equal(mcpTokenCanApplyMigrations(MCP_CAPABILITY_PRESET_MIGRATION_PLANNER), false);
  assert.equal(mcpTokenCanApplyMigrations(MCP_CAPABILITY_PRESET_CONTROLLED_MIGRATION_APPLIER), true);
});

test("resolveMcpCapabilityPresetId matches exact preset sets", () => {
  assert.equal(
    resolveMcpCapabilityPresetId([...MCP_CAPABILITY_PRESET_MIGRATION_PLANNER]),
    "migrationPlanner",
  );
  assert.equal(
    resolveMcpCapabilityPresetId([...MCP_CAPABILITY_PRESET_CONTROLLED_MIGRATION_APPLIER]),
    "controlledMigrationApplier",
  );
  assert.equal(resolveMcpCapabilityPresetId(["project:read", "schema:read"]), null);
});

test("capabilitiesMatchPreset ignores order", () => {
  assert.equal(
    capabilitiesMatchPreset(
      ["migration:plan", "project:read", "schema:read", "backup:read", "intent:read", "activity:read"],
      MCP_CAPABILITY_PRESET_MIGRATION_PLANNER,
    ),
    true,
  );
});

test("doctor warning copy is stable", () => {
  assert.equal(MCP_MIGRATION_APPLY_DOCTOR_WARNING_LINES.length, 2);
  assert.match(MCP_MIGRATION_APPLY_DOCTOR_WARNING_LINES[0]!, /^WARNING:/);
});

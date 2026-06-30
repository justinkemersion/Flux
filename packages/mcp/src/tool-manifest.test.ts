import test from "node:test";
import assert from "node:assert/strict";
import { MCP_CAPABILITIES } from "@flux/cli/api-client";
import {
  FLUX_MCP_BLOCKED_TOOL_NAMES,
  FLUX_MCP_TOOL_MANIFEST,
  manifestRequiredCapabilities,
  manifestToolNames,
} from "./tool-manifest.ts";
import { FLUX_MCP_CONTRACT_VERSION } from "@flux/core/mcp-contract";
import { MCP_TOOL_REQUIRED_CAPABILITIES } from "./mcp-tool-capabilities.ts";

test("manifest contract version is 0.1.0", () => {
  assert.equal(FLUX_MCP_CONTRACT_VERSION, "0.1.0");
});

test("manifest registers exactly 14 tools", () => {
  assert.equal(FLUX_MCP_TOOL_MANIFEST.length, 14);
});

test("manifest tool names snapshot", () => {
  const names = manifestToolNames().sort();
  assert.deepEqual(names, [
    "flux.activity",
    "flux.backup.ensureVerified",
    "flux.backup.list",
    "flux.credentials.temporary",
    "flux.destructive.preflight",
    "flux.doctor",
    "flux.migration.apply",
    "flux.migration.plan",
    "flux.migrations.list",
    "flux.project.describe",
    "flux.project.list",
    "flux.query.readonly",
    "flux.schema.counts",
    "flux.schema.inspect",
  ]);
});

test("blocked destructive tools are absent from manifest", () => {
  const registered = new Set(manifestToolNames());
  for (const blocked of FLUX_MCP_BLOCKED_TOOL_NAMES) {
    assert.equal(registered.has(blocked), false, `${blocked} must not be registered`);
  }
});

test("no manifest entry uses blocked_destructive risk or destructive operationClass", () => {
  for (const entry of FLUX_MCP_TOOL_MANIFEST) {
    assert.notEqual(entry.riskLevel, "blocked_destructive");
    assert.notEqual(entry.operationClass, "destructive");
  }
});

test("flux.migration.apply requires migration:apply capability", () => {
  const apply = FLUX_MCP_TOOL_MANIFEST.find((e) => e.name === "flux.migration.apply");
  assert.ok(apply);
  assert.equal(apply.requiredCapability, "migration:apply");
  assert.equal(apply.operationClass, "write");
  assert.equal(apply.riskLevel, "guarded_mutation");
});

test("flux.credentials.temporary is security-sensitive guarded mutation write", () => {
  const cred = FLUX_MCP_TOOL_MANIFEST.find((e) => e.name === "flux.credentials.temporary");
  assert.ok(cred);
  assert.equal(cred.riskLevel, "guarded_mutation");
  assert.equal(cred.operationClass, "write");
});

test("manifest required capabilities use known MCP capability enum", () => {
  const known = new Set<string>(MCP_CAPABILITIES);
  for (const entry of FLUX_MCP_TOOL_MANIFEST) {
    assert.ok(known.has(entry.requiredCapability), entry.name);
  }
});

test("mcp-tool-capabilities matches manifest", () => {
  assert.deepEqual(MCP_TOOL_REQUIRED_CAPABILITIES, manifestRequiredCapabilities());
});

test("every manifest entry has object inputSchema", () => {
  for (const entry of FLUX_MCP_TOOL_MANIFEST) {
    assert.equal((entry.inputSchema as { type?: string }).type, "object", entry.name);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { parseFluxResourceUri } from "./resource-capability-guard.js";
import { FLUX_MCP_PROMPTS, isFluxMcpPromptName, renderFluxPrompt } from "./prompts.js";
import { offlineContractChecks } from "./scripts/mcp-smoke-lib.js";

test("parseFluxResourceUri recognizes project and doc URIs", () => {
  assert.deepEqual(parseFluxResourceUri("flux://projects"), { kind: "projects" });
  assert.deepEqual(parseFluxResourceUri("flux://projects/abc1234"), {
    kind: "project",
    hash: "abc1234",
  });
  assert.deepEqual(parseFluxResourceUri("flux://projects/abc1234/schema"), {
    kind: "project_sub",
    hash: "abc1234",
    sub: "schema",
  });
  assert.deepEqual(parseFluxResourceUri("flux://docs/guides/mcp"), {
    kind: "doc",
    slug: "guides/mcp",
  });
});

test("prompts list includes six workflow prompts", () => {
  assert.equal(FLUX_MCP_PROMPTS.length, 6);
  for (const name of [
    "flux.production_readiness",
    "flux.migration_review",
    "flux.rls_debug",
    "flux.nextjs_app_setup",
    "flux.backup_before_migration",
    "flux.project_brief_refresh",
  ]) {
    assert.ok(isFluxMcpPromptName(name));
  }
});

test("renderFluxPrompt requires hash argument", () => {
  assert.throws(() => renderFluxPrompt("flux.production_readiness", {}), /hash/);
  const rendered = renderFluxPrompt("flux.production_readiness", { hash: "abc1234" });
  assert.match(rendered.messages[0]?.content.text ?? "", /abc1234/);
});

test("offlineContractChecks passes", () => {
  const lines = offlineContractChecks();
  assert.ok(lines.some((l: string) => l.includes("14 tools")));
});

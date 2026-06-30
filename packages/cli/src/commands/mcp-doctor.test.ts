import test from "node:test";
import assert from "node:assert/strict";
import { mcpDoctorPostVerifyWarnings, runMcpDoctorAsync } from "./mcp-doctor.ts";

test("runMcpDoctorAsync fails when FLUX_MCP_TOKEN is missing", async () => {
  const prev = process.env.FLUX_MCP_TOKEN;
  delete process.env.FLUX_MCP_TOKEN;
  try {
    const result = await runMcpDoctorAsync({ token: "" });
    assert.equal(result.ok, false);
    assert.match(result.lines.join("\n"), /FLUX_MCP_TOKEN is not set/);
  } finally {
    if (prev !== undefined) process.env.FLUX_MCP_TOKEN = prev;
  }
});

test("mcpDoctorPostVerifyWarnings is empty for planner-only capabilities", () => {
  assert.deepEqual(mcpDoctorPostVerifyWarnings(["project:read", "migration:plan"]), []);
});

test("mcpDoctorPostVerifyWarnings is loud for migration:apply tokens", () => {
  const lines = mcpDoctorPostVerifyWarnings(["project:read", "migration:apply"]);
  assert.equal(lines[0], "");
  assert.match(lines.join("\n"), /WARNING: This MCP token can apply migrations/);
  assert.match(lines.join("\n"), /planner-only token for everyday Cursor sessions/);
});

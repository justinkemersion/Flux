import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertMcpToolCapabilityAllowed,
  denialContainsTokenSecret,
  resetMcpTokenProfileCache,
} from "./mcp-capability-guard.ts";
import type { FluxToolClient } from "./tools";

function makeValidMcpToken(): string {
  const keyId = "aabbccddeeff";
  const secret = "0123456789abcdef0123";
  const checksum = createHash("sha256")
    .update(`flx_mcp_${keyId}_${secret}`, "utf8")
    .digest("hex")
    .slice(0, 4)
    .toLowerCase();
  return `flx_mcp_${keyId}_${secret}_${checksum}`;
}

const VALID_MCP = makeValidMcpToken();
const VALID_CLI =
  "flx_live_0123456789abcdef0123456789abcd_ab12";

function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
    const value = vars[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve(fn()).finally(() => {
    resetMcpTokenProfileCache();
    for (const key of Object.keys(vars)) {
      const value = prev[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function mockClient(capabilities: string[]): FluxToolClient {
  return {
    verifyToken: async () => ({
      ok: true as const,
      tokenFamily: "mcp" as const,
      capabilities,
      projectIds: [],
      expiresAt: "2026-12-31T00:00:00.000Z",
      keyPreview: "flx_mcp_aabb…0123",
      embeddedKeyId: "aabbccddeeff",
    }),
  } as unknown as FluxToolClient;
}

test("assertMcpToolCapabilityAllowed allows tools when capability is present", async () => {
  await withEnv(
    { FLUX_MCP_TOKEN: VALID_MCP, FLUX_API_TOKEN: undefined },
    async () => {
      const denial = await assertMcpToolCapabilityAllowed(
        "flux.project.list",
        mockClient(["project:read"]),
      );
      assert.equal(denial, null);
    },
  );
});

test("assertMcpToolCapabilityAllowed denies tools without required capability", async () => {
  await withEnv(
    { FLUX_MCP_TOKEN: VALID_MCP, FLUX_API_TOKEN: undefined },
    async () => {
      const denial = await assertMcpToolCapabilityAllowed(
        "flux.migration.apply",
        mockClient(["project:read", "schema:read"]),
      );
      assert.ok(denial);
      assert.equal(denial!.ok, false);
      assert.match(denial!.summary, /flux\.migration\.apply/);
      assert.match(denial!.summary, /migration:apply/);
      assert.match(denial!.remediation!, /\/settings\/mcp-tokens/);
      assert.equal(denialContainsTokenSecret(denial!, VALID_MCP), false);
    },
  );
});

test("assertMcpToolCapabilityAllowed does not block legacy FLUX_API_TOKEN", async () => {
  await withEnv(
    { FLUX_MCP_TOKEN: undefined, FLUX_API_TOKEN: VALID_CLI },
    async () => {
      const denial = await assertMcpToolCapabilityAllowed(
        "flux.migration.apply",
        mockClient([]),
      );
      assert.equal(denial, null);
    },
  );
});

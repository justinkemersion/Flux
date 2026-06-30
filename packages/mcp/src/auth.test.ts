import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapMcpAuth } from "./auth.ts";
import { NO_MCP_TOKEN_WARNING, warningContainsTokenValue } from "@flux/cli/api-client";

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
  fn: () => void,
): void {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
    const value = vars[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(vars)) {
      const value = prev[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("bootstrapMcpAuth writes legacy warning to stderr only", () => {
  const stderr: string[] = [];
  const stdout: string[] = [];
  withEnv(
    {
      FLUX_MCP_TOKEN: undefined,
      FLUX_API_TOKEN: VALID_CLI,
    },
    () => {
      const resolved = bootstrapMcpAuth((message) => {
        stderr.push(message);
      });
      assert.equal(resolved.source, "FLUX_API_TOKEN");
    },
  );
  assert.equal(stdout.length, 0);
  assert.equal(stderr.length, 1);
  assert.match(stderr[0]!, /Prefer scoped FLUX_MCP_TOKEN/);
  assert.equal(stderr[0]!.includes(VALID_CLI), false);
});

test("bootstrapMcpAuth does not warn for FLUX_MCP_TOKEN", () => {
  const stderr: string[] = [];
  withEnv(
    {
      FLUX_MCP_TOKEN: VALID_MCP,
      FLUX_API_TOKEN: VALID_CLI,
    },
    () => {
      const resolved = bootstrapMcpAuth((message) => {
        stderr.push(message);
      });
      assert.equal(resolved.source, "FLUX_MCP_TOKEN");
    },
  );
  assert.equal(stderr.length, 0);
});

test("bootstrapMcpAuth throws on invalid FLUX_MCP_TOKEN before serving", () => {
  withEnv({ FLUX_MCP_TOKEN: VALID_CLI, FLUX_API_TOKEN: undefined }, () => {
    assert.throws(
      () => bootstrapMcpAuth(() => undefined),
      /FLUX_MCP_TOKEN must be a scoped flx_mcp_/,
    );
  });
});

test("NO_MCP_TOKEN_WARNING is stderr-safe and mentions FLUX_MCP_TOKEN", () => {
  assert.match(NO_MCP_TOKEN_WARNING, /FLUX_MCP_TOKEN/);
  assert.equal(warningContainsTokenValue(NO_MCP_TOKEN_WARNING, "flx_live_secret"), false);
});

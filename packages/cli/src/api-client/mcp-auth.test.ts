import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertValidMcpEnvToken,
  detectTokenFamily,
  isSafeMcpKeyPreview,
  isValidMcpTokenFormat,
  legacyMcpTokenWarningForSource,
  LEGACY_MCP_TOKEN_WARNING,
  resolveMcpServerToken,
  stringContainsMcpTokenMaterial,
  warningContainsTokenValue,
} from "./mcp-auth.ts";

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

test("resolveMcpServerToken prefers FLUX_MCP_TOKEN over FLUX_API_TOKEN", () => {
  withEnv(
    {
      FLUX_MCP_TOKEN: VALID_MCP,
      FLUX_API_TOKEN: VALID_CLI,
    },
    () => {
      const resolved = resolveMcpServerToken();
      assert.equal(resolved.source, "FLUX_MCP_TOKEN");
      assert.equal(resolved.token, VALID_MCP);
      assert.equal(resolved.family, "mcp");
    },
  );
});

test("resolveMcpServerToken falls back to FLUX_API_TOKEN", () => {
  withEnv(
    {
      FLUX_MCP_TOKEN: undefined,
      FLUX_API_TOKEN: VALID_CLI,
    },
    () => {
      const resolved = resolveMcpServerToken();
      assert.equal(resolved.source, "FLUX_API_TOKEN");
      assert.equal(resolved.token, VALID_CLI);
      assert.equal(resolved.family, "cli");
    },
  );
});

test("resolveMcpServerToken falls back to config file when env tokens unset", () => {
  withEnv(
    {
      FLUX_MCP_TOKEN: undefined,
      FLUX_API_TOKEN: undefined,
    },
    () => {
      const resolved = resolveMcpServerToken();
      if (resolved.token) {
        assert.equal(resolved.source, "config_file");
        assert.ok(resolved.family === "cli" || resolved.family === "mcp" || resolved.family === "unknown");
      } else {
        assert.equal(resolved.source, "none");
      }
    },
  );
});

test("invalid FLUX_MCP_TOKEN prefix fails startup validation", () => {
  withEnv({ FLUX_MCP_TOKEN: VALID_CLI }, () => {
    const resolved = resolveMcpServerToken();
    assert.throws(
      () => assertValidMcpEnvToken(resolved),
      /FLUX_MCP_TOKEN must be a scoped flx_mcp_/,
    );
  });
});

test("invalid FLUX_MCP_TOKEN format fails startup validation", () => {
  withEnv({ FLUX_MCP_TOKEN: "flx_mcp_short" }, () => {
    const resolved = resolveMcpServerToken();
    assert.throws(
      () => assertValidMcpEnvToken(resolved),
      /invalid flx_mcp_ format/,
    );
  });
});

test("legacy sources produce stderr warning without token value", () => {
  const warning = legacyMcpTokenWarningForSource("FLUX_API_TOKEN");
  assert.equal(warning, LEGACY_MCP_TOKEN_WARNING);
  assert.equal(warningContainsTokenValue(warning!, VALID_CLI), false);
  assert.match(warning!, /\/settings\/mcp-tokens/);
  assert.equal(legacyMcpTokenWarningForSource("config_file"), LEGACY_MCP_TOKEN_WARNING);
  assert.equal(legacyMcpTokenWarningForSource("FLUX_MCP_TOKEN"), null);
});

test("detectTokenFamily classifies mcp, cli, and unknown", () => {
  assert.equal(detectTokenFamily(VALID_MCP), "mcp");
  assert.equal(detectTokenFamily(VALID_CLI), "cli");
  assert.equal(detectTokenFamily("opaque-token"), "unknown");
});

test("isValidMcpTokenFormat validates checksum-shaped tokens", () => {
  assert.equal(isValidMcpTokenFormat("flx_mcp_short"), false);
  assert.equal(isValidMcpTokenFormat(VALID_MCP), true);
});

test("valid FLUX_MCP_TOKEN passes startup validation", () => {
  withEnv({ FLUX_MCP_TOKEN: VALID_MCP }, () => {
    const resolved = resolveMcpServerToken();
    assert.doesNotThrow(() => assertValidMcpEnvToken(resolved));
  });
});

test("stringContainsMcpTokenMaterial detects full, partial, and Bearer MCP tokens", () => {
  assert.equal(stringContainsMcpTokenMaterial(VALID_MCP), true);
  assert.equal(stringContainsMcpTokenMaterial("flx_mcp_aabbccddeeff_0123"), true);
  assert.equal(stringContainsMcpTokenMaterial(`Bearer ${VALID_MCP}`), true);
  assert.equal(isSafeMcpKeyPreview("flx_mcp_aabb…0123"), true);
  assert.equal(stringContainsMcpTokenMaterial("flx_mcp_aabb…0123"), false);
});

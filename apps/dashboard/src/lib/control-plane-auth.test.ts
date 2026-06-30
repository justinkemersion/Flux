import test from "node:test";
import assert from "node:assert/strict";
import {
  controlPlaneAuthPersistenceMetadata,
  mergeControlPlaneAuthMetadata,
  type ControlPlaneAuth,
} from "./control-plane-auth.ts";

const MCP_AUTH: ControlPlaneAuth = {
  keyType: "mcp" as const,
  userId: "user-1",
  keyId: "00000000-0000-4000-8000-000000000001",
  capabilities: ["project:read" as const],
  projectIds: ["proj-1"],
  expiresAt: new Date("2026-12-31T00:00:00.000Z"),
  keyPreview: "flx_mcp_aabb…0123",
  embeddedKeyId: "aabbccddeeff",
};

const CLI_AUTH = {
  keyType: "cli" as const,
  userId: "user-1",
  keyId: "key-cli-1",
};

test("controlPlaneAuthPersistenceMetadata records MCP keyPreview without secrets", () => {
  const meta = controlPlaneAuthPersistenceMetadata(MCP_AUTH);
  assert.equal(meta.authFamily, "mcp");
  assert.equal(meta.keyType, "mcp");
  assert.equal(meta.keyPreview, "flx_mcp_aabb…0123");
  assert.equal(meta.embeddedKeyId, "aabbccddeeff");
  assert.equal("token" in meta, false);
  assert.equal("keyHash" in meta, false);
});

test("controlPlaneAuthPersistenceMetadata preserves CLI behavior", () => {
  const meta = controlPlaneAuthPersistenceMetadata(CLI_AUTH);
  assert.deepEqual(meta, { authFamily: "cli", keyType: "cli" });
});

test("mergeControlPlaneAuthMetadata strips token material and merges MCP auth", () => {
  const merged = mergeControlPlaneAuthMetadata(MCP_AUTH, {
    gate: "mcp_token_capability_denied",
    token: "flx_mcp_secret_should_drop",
    keyHash: "sha256-should-drop",
  });
  assert.equal(merged?.gate, "mcp_token_capability_denied");
  assert.equal(merged?.keyPreview, "flx_mcp_aabb…0123");
  assert.equal("token" in (merged ?? {}), false);
  assert.equal("keyHash" in (merged ?? {}), false);
});

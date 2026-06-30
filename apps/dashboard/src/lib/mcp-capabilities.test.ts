import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultMcpTokenExpiryDays,
  defaultMcpTokenExpiresAt,
  isMutationCapableMcpToken,
  maxMcpTokenExpiryDays,
  MCP_CAPABILITIES,
  validateMcpCapabilities,
  validateMcpTokenExpiry,
} from "./mcp-capabilities.ts";

test("validateMcpCapabilities accepts all known capabilities", () => {
  const result = validateMcpCapabilities([...MCP_CAPABILITIES]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.capabilities.length, MCP_CAPABILITIES.length);
  }
});

test("validateMcpCapabilities rejects unknown capabilities", () => {
  const result = validateMcpCapabilities(["project:read", "nuke:everything"]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Unknown capability/);
  }
});

test("validateMcpCapabilities rejects empty list", () => {
  const result = validateMcpCapabilities([]);
  assert.equal(result.ok, false);
});

test("isMutationCapableMcpToken classifies mutation vs read-only", () => {
  assert.equal(isMutationCapableMcpToken(["project:read", "schema:read"]), false);
  assert.equal(isMutationCapableMcpToken(["migration:plan", "backup:read"]), false);
  assert.equal(isMutationCapableMcpToken(["migration:apply"]), true);
  assert.equal(isMutationCapableMcpToken(["backup:ensure_verified"]), true);
});

test("expiry defaults and max follow read-only vs mutation tiers", () => {
  const readOnly = ["project:read", "intent:read", "activity:read"];
  assert.equal(defaultMcpTokenExpiryDays(readOnly), 30);
  assert.equal(maxMcpTokenExpiryDays(readOnly), 90);

  const mutation = ["migration:plan", "migration:apply"];
  assert.equal(defaultMcpTokenExpiryDays(mutation), 7);
  assert.equal(maxMcpTokenExpiryDays(mutation), 30);
});

test("defaultMcpTokenExpiresAt uses tier default days", () => {
  const now = new Date("2026-06-01T12:00:00.000Z");
  const readOnlyExpiry = defaultMcpTokenExpiresAt(["activity:read"], now);
  assert.equal(readOnlyExpiry.toISOString(), "2026-07-01T12:00:00.000Z");

  const mutationExpiry = defaultMcpTokenExpiresAt(["migration:apply"], now);
  assert.equal(mutationExpiry.toISOString(), "2026-06-08T12:00:00.000Z");
});

test("validateMcpTokenExpiry enforces future and max window", () => {
  const now = new Date("2026-06-01T12:00:00.000Z");
  const caps = ["project:read"];

  assert.equal(validateMcpTokenExpiry(new Date("2026-05-01T00:00:00Z"), caps, now).ok, false);
  assert.equal(
    validateMcpTokenExpiry(new Date("2026-12-01T00:00:00Z"), caps, now).ok,
    false,
  );
  assert.equal(
    validateMcpTokenExpiry(new Date("2026-07-01T00:00:00Z"), caps, now).ok,
    true,
  );

  const mutationCaps = ["backup:ensure_verified"];
  assert.equal(
    validateMcpTokenExpiry(new Date("2026-07-15T00:00:00Z"), mutationCaps, now).ok,
    false,
  );
  assert.equal(
    validateMcpTokenExpiry(new Date("2026-06-20T00:00:00Z"), mutationCaps, now).ok,
    true,
  );
});

test("intent:read and activity:read are distinct known capabilities", () => {
  assert.equal(validateMcpCapabilities(["intent:read"]).ok, true);
  assert.equal(validateMcpCapabilities(["activity:read"]).ok, true);
  const both = validateMcpCapabilities(["intent:read", "activity:read"]);
  assert.equal(both.ok, true);
  if (both.ok) {
    assert.deepEqual(both.capabilities, ["intent:read", "activity:read"]);
  }
});

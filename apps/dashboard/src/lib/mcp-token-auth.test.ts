import test from "node:test";
import assert from "node:assert/strict";
import {
  FLUX_MCP_KEY_PREFIX,
  FLUX_MCP_TOKEN_REGEX,
  checksumForMcpTokenMaterial,
  generateMcpToken,
  hashMcpToken,
  isMcpTokenLike,
  parseMcpToken,
  previewMcpToken,
  previewMcpTokenFromParts,
} from "./mcp-token-auth.ts";

test("generateMcpToken matches expected format", () => {
  const issued = generateMcpToken();
  assert.match(issued.token, FLUX_MCP_TOKEN_REGEX);
  assert.equal(issued.token.startsWith(`${FLUX_MCP_KEY_PREFIX}_`), true);
  assert.equal(issued.keyId.length, 12);
  assert.match(issued.keyPreview, /^flx_mcp_[a-f0-9]{4}…[a-f0-9]{4}$/);
});

test("parseMcpToken accepts valid token and rejects bad checksum", () => {
  const issued = generateMcpToken();
  const parsed = parseMcpToken(issued.token);
  assert.deepEqual(parsed, {
    keyId: issued.keyId,
    secret: issued.token.split("_")[3],
  });

  const tampered = issued.token.replace(/.$/, issued.token.endsWith("a") ? "b" : "a");
  assert.equal(parseMcpToken(tampered), null);
});

test("parseMcpToken rejects invalid prefix", () => {
  assert.equal(parseMcpToken("flx_live_abcd0123456789abcd0123456789_abcd"), null);
  assert.equal(parseMcpToken("not_a_token"), null);
  assert.equal(parseMcpToken(""), null);
});

test("hashMcpToken is stable and not reversible to plaintext", () => {
  const issued = generateMcpToken();
  const hash1 = hashMcpToken(issued.token);
  const hash2 = hashMcpToken(issued.token);
  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 64);
  assert.notEqual(hash1, issued.token);
  assert.equal(hash1.includes(issued.keyId), false);
});

test("previewMcpToken and key id segment are stable and safe", () => {
  const issued = generateMcpToken();
  const preview = previewMcpToken(issued.token);
  assert.equal(preview, issued.keyPreview);
  assert.equal(preview?.includes(issued.token.split("_")[3] ?? ""), false);

  const parts = issued.token.split("_");
  const keyId = parts[2] ?? "";
  const secret = parts[3] ?? "";
  assert.equal(previewMcpTokenFromParts(keyId, secret), issued.keyPreview);
});

test("isMcpTokenLike detects MCP family without full validation", () => {
  const issued = generateMcpToken();
  assert.equal(isMcpTokenLike(issued.token), true);
  assert.equal(isMcpTokenLike("flx_mcp_short"), true);
  assert.equal(isMcpTokenLike("flx_live_abc"), false);
});

test("checksumForMcpTokenMaterial is deterministic", () => {
  const sum = checksumForMcpTokenMaterial("abcd12345678", "0123456789abcdef0123");
  assert.match(sum, /^[a-f0-9]{4}$/);
  assert.equal(
    checksumForMcpTokenMaterial("abcd12345678", "0123456789abcdef0123"),
    sum,
  );
});

test("two generated tokens are unique", () => {
  const a = generateMcpToken();
  const b = generateMcpToken();
  assert.notEqual(a.token, b.token);
  assert.notEqual(a.keyHash, b.keyHash);
  assert.notEqual(a.keyId, b.keyId);
});

import test from "node:test";
import assert from "node:assert/strict";
import { generateMcpToken } from "./mcp-token-auth.ts";
import type { SafeMcpTokenRecord } from "./mcp-token-sanitize.ts";
import {
  MCP_TOKEN_API,
  MCP_TOKENS_PAGE_PATH,
  applyCreateTokenToList,
  applyRevokeToTokenList,
  formatProjectLabel,
  mcpTokenDisplayContainsSecret,
  mcpTokenExpiryOptions,
  mcpTokenListDisplayPayload,
  mcpTokensSignInRedirectUrl,
  parseMcpTokenCreateResponse,
  resolveMcpTokenStatus,
  showsMutationCapableWarning,
  toMcpTokenListRows,
  validateMcpTokenCreateForm,
} from "../components/mcp-tokens/mcp-tokens-utils.ts";

const NOW = new Date("2026-06-30T12:00:00.000Z");
const PROJECT_A = "00000000-0000-4000-8000-000000000001";
const PROJECT_B = "00000000-0000-4000-8000-000000000002";

const PROJECTS = {
  [PROJECT_A]: { id: PROJECT_A, name: "Alpha", slug: "alpha" },
  [PROJECT_B]: { id: PROJECT_B, name: "Beta", slug: "beta" },
};

function sampleToken(overrides: Partial<SafeMcpTokenRecord> = {}): SafeMcpTokenRecord {
  return {
    id: "00000000-0000-4000-8000-000000000099",
    keyId: "aabbccddeeff",
    keyPreview: "flx_mcp_aabb…efff",
    name: "ci-bot",
    projectIds: [PROJECT_A],
    capabilities: ["project:read", "schema:read"],
    expiresAt: "2030-01-01T00:00:00.000Z",
    revokedAt: null,
    createdAt: "2026-06-30T12:00:00.000Z",
    lastUsedAt: null,
    metadata: { name: "ci-bot" },
    ...overrides,
  };
}

test("unauthenticated users are redirected to sign-in for MCP tokens page", () => {
  const url = mcpTokensSignInRedirectUrl();
  assert.match(url, /^\/api\/auth\/signin\?callbackUrl=/);
  assert.ok(url.includes(encodeURIComponent(MCP_TOKENS_PAGE_PATH)));
});

test("page lists tokens from safe list rows", () => {
  const rows = toMcpTokenListRows([sampleToken(), sampleToken({ id: "other", name: "ops" })], PROJECTS, NOW);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.name, "ci-bot");
  assert.equal(rows[0]?.projectLabel, "Alpha (alpha)");
  assert.equal(rows[0]?.status, "active");
});

test("create form requires project and capability", () => {
  assert.equal(validateMcpTokenCreateForm({ projectIds: [], capabilities: ["project:read"] }), "Select at least one project.");
  assert.equal(validateMcpTokenCreateForm({ projectIds: [PROJECT_A], capabilities: [] }), "Select at least one capability.");
  assert.equal(validateMcpTokenCreateForm({ projectIds: [PROJECT_A], capabilities: ["project:read"] }), null);
});

test("mutation-capable capability shows warning helper", () => {
  assert.equal(showsMutationCapableWarning(["project:read"]), false);
  assert.equal(showsMutationCapableWarning(["migration:apply"]), true);
  assert.equal(showsMutationCapableWarning(["backup:ensure_verified", "schema:read"]), true);
});

test("create displays plaintext token once via create response parser", () => {
  const issued = generateMcpToken();
  const tokenRecord = sampleToken();
  const parsed = parseMcpTokenCreateResponse({ token: issued.token, tokenRecord });
  assert.ok(parsed);
  assert.equal(parsed!.token, issued.token);
  assert.equal(parsed!.tokenRecord.id, tokenRecord.id);
  assert.equal(parseMcpTokenCreateResponse({ tokens: [tokenRecord] }), null);
});

test("list never displays plaintext token or keyHash", () => {
  const issued = generateMcpToken();
  const rows = toMcpTokenListRows(
    [sampleToken(), sampleToken({ id: "2", name: "ops" })],
    PROJECTS,
    NOW,
  );
  const payload = mcpTokenListDisplayPayload(rows);
  assert.equal(mcpTokenDisplayContainsSecret(payload), false);
  assert.equal(JSON.stringify(payload).includes(issued.token), false);
  for (const row of rows) {
    assert.equal("token" in row, false);
    assert.equal("keyHash" in row, false);
    assert.equal("key_hash" in row, false);
  }
});

test("revoke uses DELETE route and updates list state", () => {
  const token = sampleToken();
  const url = MCP_TOKEN_API.revoke(token.id);
  assert.equal(url, `/api/agent/mcp-tokens/${token.id}`);
  const updated = applyRevokeToTokenList([token], token.id, "2026-07-01T00:00:00.000Z");
  assert.equal(updated[0]?.revokedAt, "2026-07-01T00:00:00.000Z");
  assert.equal(resolveMcpTokenStatus(updated[0]!, NOW), "revoked");
});

test("create prepends token record without persisting plaintext in list state", () => {
  const existing = sampleToken();
  const created = sampleToken({ id: "new-row", name: "new" });
  const next = applyCreateTokenToList([existing], created);
  assert.equal(next.length, 2);
  assert.equal(next[0]?.id, "new-row");
  assert.equal(mcpTokenDisplayContainsSecret(next), false);
});

test("expired and revoked status renders correctly", () => {
  const expired = resolveMcpTokenStatus(
    { revokedAt: null, expiresAt: "2020-01-01T00:00:00.000Z" },
    NOW,
  );
  const revoked = resolveMcpTokenStatus(
    { revokedAt: "2026-06-29T00:00:00.000Z", expiresAt: "2030-01-01T00:00:00.000Z" },
    NOW,
  );
  assert.equal(expired, "expired");
  assert.equal(revoked, "revoked");

  const rows = toMcpTokenListRows(
    [
      sampleToken({ expiresAt: "2020-01-01T00:00:00.000Z" }),
      sampleToken({ id: "revoked", revokedAt: "2026-06-29T00:00:00.000Z" }),
    ],
    PROJECTS,
    NOW,
  );
  assert.equal(rows[0]?.status, "expired");
  assert.equal(rows[1]?.status, "revoked");
});

test("expiry options respect mutation vs read-only tiers", () => {
  const readOnly = mcpTokenExpiryOptions(["project:read"]);
  const mutation = mcpTokenExpiryOptions(["migration:apply"]);
  assert.ok(readOnly.some((o) => o.days === 30));
  assert.ok(readOnly.some((o) => o.days === 90));
  assert.equal(mutation.some((o) => o.days > 30), false);
  assert.ok(mutation.some((o) => o.days === 7));
});

test("project labels collapse when many projects selected", () => {
  assert.equal(
    formatProjectLabel([PROJECT_A, PROJECT_B], PROJECTS),
    "Alpha (alpha), Beta (beta)",
  );
  assert.equal(
    formatProjectLabel([PROJECT_A, PROJECT_B, "00000000-0000-4000-8000-000000000003"], PROJECTS),
    "3 projects",
  );
});

test("no token leakage in rendered list/detail output", () => {
  const issued = generateMcpToken();
  const bad = {
    token: issued.token,
    keyHash: "abc123",
    tokens: [{ keyPreview: "flx_mcp_abcd…wxyz" }],
  };
  assert.equal(mcpTokenDisplayContainsSecret(bad), true);
  assert.equal(mcpTokenDisplayContainsSecret({ tokens: [sampleToken()] }), false);
});

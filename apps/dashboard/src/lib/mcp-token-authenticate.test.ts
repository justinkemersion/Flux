import test from "node:test";
import assert from "node:assert/strict";
import { generateMcpToken, hashMcpToken } from "./mcp-token-auth.ts";
import { authenticateMcpToken } from "./mcp-token-authenticate.ts";

const USER_ID = "user-mcp-1";
const PROJECT_A = "00000000-0000-4000-8000-000000000001";
const PROJECT_B = "00000000-0000-4000-8000-000000000002";

type TokenRow = {
  id: string;
  userId: string;
  keyHash: string;
  keyId: string;
  keyPreview: string;
  projectIds: string[];
  capabilities: string[];
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
};

function mockMcpTokenDb(rows: TokenRow[]) {
  let lastUsedAtUpdates = 0;
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            return rows.map((row) => ({
              id: row.id,
              userId: row.userId,
              keyId: row.keyId,
              keyPreview: row.keyPreview,
              projectIds: row.projectIds,
              capabilities: row.capabilities,
              expiresAt: row.expiresAt,
              revokedAt: row.revokedAt,
            }));
          },
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => {
          lastUsedAtUpdates += 1;
          return undefined;
        },
      }),
    }),
    get lastUsedAtUpdates() {
      return lastUsedAtUpdates;
    },
  };
  return db;
}

function seedRow(overrides: Partial<TokenRow> = {}): { row: TokenRow; token: string } {
  const issued = generateMcpToken();
  const row: TokenRow = {
    id: "row-uuid-1",
    userId: USER_ID,
    keyHash: issued.keyHash,
    keyId: issued.keyId,
    keyPreview: issued.keyPreview,
    projectIds: [PROJECT_A],
    capabilities: ["project:read", "schema:read"],
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    revokedAt: null,
    lastUsedAt: null,
    ...overrides,
  };
  if (overrides.keyHash === undefined && overrides.keyId === undefined) {
    row.keyHash = issued.keyHash;
    row.keyId = issued.keyId;
    row.keyPreview = issued.keyPreview;
  }
  return { row, token: issued.token };
}

test("authenticateMcpToken accepts valid token", async () => {
  const { row, token } = seedRow();
  const db = mockMcpTokenDb([row]);
  const result = await authenticateMcpToken(db as never, token, {
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.auth.keyType, "mcp");
  assert.equal(result.auth.userId, USER_ID);
  assert.equal(result.auth.keyId, row.id);
  assert.equal(result.auth.embeddedKeyId, row.keyId);
  assert.deepEqual(result.auth.projectIds, [PROJECT_A]);
  assert.equal(db.lastUsedAtUpdates, 1);
});

test("authenticateMcpToken rejects invalid prefix and checksum", async () => {
  const db = mockMcpTokenDb([]);
  assert.equal((await authenticateMcpToken(db as never, "flx_live_bad")).ok, false);
  assert.equal((await authenticateMcpToken(db as never, "flx_mcp_short")).ok, false);
  const { token } = seedRow();
  const bad = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  assert.equal((await authenticateMcpToken(db as never, bad)).ok, false);
});

test("authenticateMcpToken rejects unknown, expired, and revoked tokens", async () => {
  const { token } = seedRow();
  const unknownDb = mockMcpTokenDb([]);
  assert.equal((await authenticateMcpToken(unknownDb as never, token)).ok, false);

  const { row: expiredRow, token: expiredToken } = seedRow({
    expiresAt: new Date("2020-01-01T00:00:00.000Z"),
  });
  const expired = await authenticateMcpToken(mockMcpTokenDb([expiredRow]) as never, expiredToken, {
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(expired.ok, false);
  if (expired.ok) return;
  assert.equal(expired.reason, "expired");

  const { row: revokedRow, token: revokedToken } = seedRow({
    revokedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  const revoked = await authenticateMcpToken(mockMcpTokenDb([revokedRow]) as never, revokedToken);
  assert.equal(revoked.ok, false);
  if (revoked.ok) return;
  assert.equal(revoked.reason, "revoked");
});

test("hashMcpToken is not reversible from stored hash", () => {
  const issued = generateMcpToken();
  const hash = hashMcpToken(issued.token);
  assert.notEqual(hash, issued.token);
  assert.equal(hash.includes(issued.keyId), false);
});

test("authenticateMcpToken rejects tokens with unknown stored capabilities", async () => {
  const { row, token } = seedRow({ capabilities: ["project:read", "nuke:all"] });
  const result = await authenticateMcpToken(mockMcpTokenDb([row]) as never, token);
  assert.equal(result.ok, false);
});

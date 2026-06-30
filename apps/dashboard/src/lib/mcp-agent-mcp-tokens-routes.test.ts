import test from "node:test";
import assert from "node:assert/strict";
import { runAgentMcpTokenCreate, runAgentMcpTokenList } from "../../app/api/agent/mcp-tokens/route.ts";
import { runAgentMcpTokenRevoke } from "../../app/api/agent/mcp-tokens/[id]/route.ts";
import {
  MCP_TOKEN_EXPIRY_DAYS,
  defaultMcpTokenExpiresAt,
  maxMcpTokenExpiryDays,
} from "./mcp-capabilities.ts";
import { generateMcpToken, hashMcpToken } from "./mcp-token-auth.ts";
import { authenticateMcpToken } from "./mcp-token-authenticate.ts";
import {
  mcpTokenListResponseContainsSecret,
  sanitizeMcpTokenMetadata,
} from "./mcp-token-sanitize.ts";
import {
  createMcpTokenForUser,
  listMcpTokensForUser,
  mcpTokenRowStoresHashOnly,
  parseCreateMcpTokenBody,
  revokeMcpTokenForUser,
} from "./mcp-tokens.ts";

const USER_A = "user-a";
const USER_B = "user-b";
const PROJECT_A = "00000000-0000-4000-8000-000000000001";
const PROJECT_B = "00000000-0000-4000-8000-000000000002";
const TOKEN_ROW_ID = "00000000-0000-4000-8000-000000000099";

const READ_ONLY_CAPS = ["project:read", "schema:read"] as const;
const MUTATION_CAPS = ["migration:apply", "project:read"] as const;

const ROUTE_DEPS = {
  initSystemDb: async () => undefined,
  authenticate: async () => ({ user: { id: USER_A } }),
};

function daysFromNow(days: number, from = new Date("2026-06-30T12:00:00.000Z")): Date {
  const out = new Date(from.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

type StoredTokenRow = {
  id: string;
  userId: string;
  keyHash: string;
  keyId: string;
  keyPreview: string;
  projectIds: string[];
  capabilities: string[];
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  metadata: Record<string, unknown> | null;
};

function mockMcpTokenCrudDb(options: {
  ownedProjectIds?: string[];
  tokens?: StoredTokenRow[];
  listUserId?: string;
  revokeUserId?: string;
  revokeTokenId?: string;
}) {
  const owned = new Set(options.ownedProjectIds ?? [PROJECT_A, PROJECT_B]);
  const tokens = options.tokens ?? [];
  const listUserId = options.listUserId ?? USER_A;
  const revokeUserId = options.revokeUserId ?? USER_A;
  const revokeTokenId = options.revokeTokenId ?? TOKEN_ROW_ID;
  let lastInsert: Record<string, unknown> | null = null;

  const db = {
    select: (shape?: Record<string, unknown>) => ({
      from: (table: { userId?: unknown; keyHash?: unknown }) => {
        const isProjects = "userId" in table && !("keyHash" in table);
        const isMcpTokens = "keyHash" in table;
        const isRevokeLookup = isMcpTokens && shape && "revokedAt" in shape && !("keyId" in shape);
        return {
          where: () => {
            if (isProjects) {
              const rows = Array.from(owned).map((id) => ({ id }));
              return Promise.resolve(rows);
            }
            if (isRevokeLookup) {
              const row = tokens.find(
                (candidate) => candidate.id === revokeTokenId && candidate.userId === revokeUserId,
              );
              return {
                limit: async () => (row ? [{ id: row.id, revokedAt: row.revokedAt }] : []),
              };
            }
            if (isMcpTokens) {
              return {
                orderBy: async () =>
                  tokens
                    .filter((row) => row.userId === listUserId)
                    .map((row) => ({
                      id: row.id,
                      keyId: row.keyId,
                      keyPreview: row.keyPreview,
                      projectIds: row.projectIds,
                      capabilities: row.capabilities,
                      expiresAt: row.expiresAt,
                      revokedAt: row.revokedAt,
                      createdAt: row.createdAt,
                      lastUsedAt: row.lastUsedAt,
                      metadata: row.metadata,
                    })),
              };
            }
            return Promise.resolve([]);
          },
        };
      },
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          lastInsert = values;
          const now = new Date("2026-06-30T12:00:00.000Z");
          return [
            {
              id: TOKEN_ROW_ID,
              keyId: values.keyId,
              keyPreview: values.keyPreview,
              projectIds: values.projectIds,
              capabilities: values.capabilities,
              expiresAt: values.expiresAt,
              revokedAt: null,
              createdAt: now,
              lastUsedAt: null,
              metadata: values.metadata ?? null,
            },
          ];
        },
      }),
    }),
    update: () => ({
      set: (patch: { revokedAt?: Date }) => ({
        where: async () => {
          const row = tokens[0];
          if (row && patch.revokedAt) {
            row.revokedAt = patch.revokedAt;
          }
        },
      }),
    }),
    get lastInsert() {
      return lastInsert;
    },
    get tokenRows() {
      return tokens;
    },
  };

  return db;
}

function mockAuthDbForAuthenticate(rows: Array<{
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
}>) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () =>
            rows.map((row) => ({
              id: row.id,
              userId: row.userId,
              keyId: row.keyId,
              keyPreview: row.keyPreview,
              projectIds: row.projectIds,
              capabilities: row.capabilities,
              expiresAt: row.expiresAt,
              revokedAt: row.revokedAt,
            })),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  };
}

test("parseCreateMcpTokenBody rejects empty projectIds and capabilities", () => {
  assert.equal(parseCreateMcpTokenBody({ projectIds: [], capabilities: ["project:read"] }).ok, false);
  assert.equal(parseCreateMcpTokenBody({ projectIds: [PROJECT_A], capabilities: [] }).ok, false);
});

test("unauthenticated create/list/revoke rejected", async () => {
  const unauth = { ...ROUTE_DEPS, authenticate: async () => null };
  const createRes = await runAgentMcpTokenCreate(
    new Request("http://test/api/agent/mcp-tokens", {
      method: "POST",
      body: JSON.stringify({ projectIds: [PROJECT_A], capabilities: READ_ONLY_CAPS }),
    }),
    { ...unauth, getDb: () => ({}) as never },
  );
  assert.equal(createRes.status, 401);

  const listRes = await runAgentMcpTokenList(new Request("http://test/api/agent/mcp-tokens"), {
    ...unauth,
    getDb: () => ({}) as never,
  });
  assert.equal(listRes.status, 401);

  const revokeRes = await runAgentMcpTokenRevoke(
    new Request("http://test/api/agent/mcp-tokens/x", { method: "DELETE" }),
    TOKEN_ROW_ID,
    { ...unauth, getDb: () => ({}) as never },
  );
  assert.equal(revokeRes.status, 401);
});

test("create rejects unknown capability", async () => {
  const res = await runAgentMcpTokenCreate(
    new Request("http://test/api/agent/mcp-tokens", {
      method: "POST",
      body: JSON.stringify({
        projectIds: [PROJECT_A],
        capabilities: ["project:read", "bogus:cap"],
      }),
    }),
    { ...ROUTE_DEPS, getDb: () => mockMcpTokenCrudDb({ ownedProjectIds: [PROJECT_A] }) as never },
  );
  assert.equal(res.status, 400);
  const json = (await res.json()) as { error: string };
  assert.match(json.error, /Unknown capability/);
});

test("create rejects project owned by another user", async () => {
  const db = mockMcpTokenCrudDb({ ownedProjectIds: [PROJECT_A] });
  const result = await createMcpTokenForUser(db as never, USER_A, {
    projectIds: [PROJECT_A, PROJECT_B],
    capabilities: [...READ_ONLY_CAPS],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 403);
});

test("create applies read-only default and max expiry", async () => {
  const now = new Date("2026-06-30T12:00:00.000Z");
  const defaultAt = defaultMcpTokenExpiresAt(READ_ONLY_CAPS, now);
  assert.equal(
    defaultAt.toISOString(),
    daysFromNow(MCP_TOKEN_EXPIRY_DAYS.readOnly.default, now).toISOString(),
  );

  const db = mockMcpTokenCrudDb({ ownedProjectIds: [PROJECT_A] });
  const created = await createMcpTokenForUser(db as never, USER_A, {
    projectIds: [PROJECT_A],
    capabilities: [...READ_ONLY_CAPS],
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const insert = db.lastInsert!;
  const expiresAt = insert.expiresAt as Date;
  const expectedDefault = defaultMcpTokenExpiresAt(READ_ONLY_CAPS);
  assert.ok(Math.abs(expiresAt.getTime() - expectedDefault.getTime()) < 60_000);

  const tooFar = daysFromNow(MCP_TOKEN_EXPIRY_DAYS.readOnly.max + 1, now).toISOString();
  const rejected = await createMcpTokenForUser(db as never, USER_A, {
    projectIds: [PROJECT_A],
    capabilities: [...READ_ONLY_CAPS],
    expiresAt: tooFar,
  });
  assert.equal(rejected.ok, false);
  assert.equal(maxMcpTokenExpiryDays(READ_ONLY_CAPS), MCP_TOKEN_EXPIRY_DAYS.readOnly.max);
});

test("create applies mutation-capable default and max expiry", async () => {
  const now = new Date("2026-06-30T12:00:00.000Z");
  const db = mockMcpTokenCrudDb({ ownedProjectIds: [PROJECT_A] });
  const created = await createMcpTokenForUser(db as never, USER_A, {
    projectIds: [PROJECT_A],
    capabilities: [...MUTATION_CAPS],
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const expiresAt = db.lastInsert!.expiresAt as Date;
  const expectedDefault = defaultMcpTokenExpiresAt(MUTATION_CAPS);
  assert.ok(Math.abs(expiresAt.getTime() - expectedDefault.getTime()) < 60_000);

  const tooFar = daysFromNow(MCP_TOKEN_EXPIRY_DAYS.mutationCapable.max + 1, now).toISOString();
  const rejected = await createMcpTokenForUser(db as never, USER_A, {
    projectIds: [PROJECT_A],
    capabilities: [...MUTATION_CAPS],
    expiresAt: tooFar,
  });
  assert.equal(rejected.ok, false);
});

test("create stores hash only and returns plaintext token once", async () => {
  const db = mockMcpTokenCrudDb({ ownedProjectIds: [PROJECT_A] });
  const created = await createMcpTokenForUser(db as never, USER_A, {
    name: "ci-bot",
    projectIds: [PROJECT_A],
    capabilities: [...READ_ONLY_CAPS],
    metadata: { env: "staging" },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const insert = db.lastInsert!;
  assert.equal(typeof insert.keyHash, "string");
  assert.equal("token" in insert, false);
  assert.ok(mcpTokenRowStoresHashOnly(insert.keyHash as string, created.token));

  const routeRes = await runAgentMcpTokenCreate(
    new Request("http://test/api/agent/mcp-tokens", {
      method: "POST",
      body: JSON.stringify({
        name: "route-token",
        projectIds: [PROJECT_A],
        capabilities: READ_ONLY_CAPS,
      }),
    }),
    { ...ROUTE_DEPS, getDb: () => mockMcpTokenCrudDb({ ownedProjectIds: [PROJECT_A] }) as never },
  );
  assert.equal(routeRes.status, 201);
  const routeJson = (await routeRes.json()) as { token: string; tokenRecord: Record<string, unknown> };
  assert.match(routeJson.token, /^flx_mcp_/);
  assert.equal(routeJson.tokenRecord.id, TOKEN_ROW_ID);
  assert.equal("keyHash" in routeJson.tokenRecord, false);
});

test("list does not include plaintext token or keyHash", async () => {
  const issued = generateMcpToken();
  const row: StoredTokenRow = {
    id: TOKEN_ROW_ID,
    userId: USER_A,
    keyHash: issued.keyHash,
    keyId: issued.keyId,
    keyPreview: issued.keyPreview,
    projectIds: [PROJECT_A],
    capabilities: [...READ_ONLY_CAPS],
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    revokedAt: null,
    createdAt: new Date("2026-06-30T12:00:00.000Z"),
    lastUsedAt: null,
    metadata: { name: "listed", note: "safe" },
  };
  const db = mockMcpTokenCrudDb({ tokens: [row] });

  const listed = await listMcpTokensForUser(db as never, USER_A);
  assert.equal(listed.ok, true);
  if (!listed.ok) return;
  assert.equal(listed.tokens.length, 1);
  assert.equal(listed.tokens[0]?.name, "listed");
  assert.equal(mcpTokenListResponseContainsSecret(listed), false);
  assert.equal("keyHash" in (listed.tokens[0] ?? {}), false);

  const routeRes = await runAgentMcpTokenList(new Request("http://test/api/agent/mcp-tokens"), {
    ...ROUTE_DEPS,
    getDb: () => db as never,
  });
  const routeJson = (await routeRes.json()) as { tokens: Array<Record<string, unknown>> };
  assert.equal(mcpTokenListResponseContainsSecret(routeJson), false);
  assert.equal("token" in routeJson, false);
  assert.equal(routeJson.tokens[0]?.keyPreview, issued.keyPreview);
});

test("revoke sets revokedAt and is owner-scoped", async () => {
  const row: StoredTokenRow = {
    id: TOKEN_ROW_ID,
    userId: USER_A,
    keyHash: "abc",
    keyId: "kid",
    keyPreview: "flx_mcp_abcd…wxyz",
    projectIds: [PROJECT_A],
    capabilities: [...READ_ONLY_CAPS],
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    revokedAt: null,
    createdAt: new Date("2026-06-30T12:00:00.000Z"),
    lastUsedAt: null,
    metadata: null,
  };
  const db = mockMcpTokenCrudDb({ tokens: [row] });

  const revoked = await revokeMcpTokenForUser(db as never, USER_A, TOKEN_ROW_ID);
  assert.equal(revoked.ok, true);
  assert.ok(row.revokedAt instanceof Date);

  const idempotent = await revokeMcpTokenForUser(db as never, USER_A, TOKEN_ROW_ID);
  assert.equal(idempotent.ok, true);

  const otherUser = await revokeMcpTokenForUser(
    mockMcpTokenCrudDb({ tokens: [row], revokeUserId: USER_B }) as never,
    USER_B,
    TOKEN_ROW_ID,
  );
  assert.equal(otherUser.ok, false);
  if (otherUser.ok) return;
  assert.equal(otherUser.status, 404);

  const routeRes = await runAgentMcpTokenRevoke(
    new Request("http://test/api/agent/mcp-tokens/x", { method: "DELETE" }),
    TOKEN_ROW_ID,
    { ...ROUTE_DEPS, getDb: () => db as never },
  );
  assert.equal(routeRes.status, 200);
  const routeJson = (await routeRes.json()) as { ok: boolean };
  assert.equal(routeJson.ok, true);
});

test("revoked and expired tokens no longer authenticate", async () => {
  const issued = generateMcpToken();
  const base = {
    id: TOKEN_ROW_ID,
    userId: USER_A,
    keyHash: issued.keyHash,
    keyId: issued.keyId,
    keyPreview: issued.keyPreview,
    projectIds: [PROJECT_A],
    capabilities: [...READ_ONLY_CAPS],
    lastUsedAt: null as Date | null,
  };

  const liveDb = mockAuthDbForAuthenticate([
    { ...base, expiresAt: new Date("2030-01-01T00:00:00.000Z"), revokedAt: null },
  ]);
  const live = await authenticateMcpToken(liveDb as never, issued.token, {
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(live.ok, true);

  const revokedDb = mockAuthDbForAuthenticate([
    { ...base, expiresAt: new Date("2030-01-01T00:00:00.000Z"), revokedAt: new Date() },
  ]);
  const revoked = await authenticateMcpToken(revokedDb as never, issued.token);
  assert.equal(revoked.ok, false);
  if (revoked.ok) return;
  assert.equal(revoked.reason, "revoked");

  const expiredDb = mockAuthDbForAuthenticate([
    { ...base, expiresAt: new Date("2020-01-01T00:00:00.000Z"), revokedAt: null },
  ]);
  const expired = await authenticateMcpToken(expiredDb as never, issued.token, {
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(expired.ok, false);
  if (expired.ok) return;
  assert.equal(expired.reason, "expired");
});

test("token metadata is sanitized", () => {
  const issued = generateMcpToken();
  const sanitized = sanitizeMcpTokenMetadata({
    name: "ops",
    token: issued.token,
    keyHash: hashMcpToken(issued.token),
    nested: issued.token,
    safe: "value",
  });
  assert.equal(sanitized.name, "ops");
  assert.equal("token" in sanitized, false);
  assert.equal("keyHash" in sanitized, false);
  assert.equal("nested" in sanitized, false);
  assert.equal(sanitized.safe, "value");
});

test("list response secret scan catches accidental plaintext leakage", () => {
  const issued = generateMcpToken();
  assert.equal(mcpTokenListResponseContainsSecret({ tokens: [{ keyPreview: "flx_mcp_abcd…wxyz" }] }), false);
  assert.equal(mcpTokenListResponseContainsSecret({ token: issued.token }), true);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  assertMcpCapability,
  assertMcpProjectScope,
  authorizeCliRoute,
  classifyMcpCliRoute,
  normalizeCliV1Path,
} from "./mcp-route-auth.ts";
import type { McpTokenAuthResult } from "./control-plane-auth.ts";
import { authenticateCliApiKey, generateFluxCliKey } from "./cli-api-auth.ts";
import { generateMcpToken } from "./mcp-token-auth.ts";

const USER_ID = "user-scope-1";
const OTHER_USER = "user-other";
const PROJECT_A = "00000000-0000-4000-8000-000000000001";
const PROJECT_B = "00000000-0000-4000-8000-000000000002";
const HASH_A = "abc1234";

function mcpAuth(
  overrides: Partial<McpTokenAuthResult> = {},
): McpTokenAuthResult {
  return {
    keyType: "mcp",
    userId: USER_ID,
    keyId: "row-uuid",
    embeddedKeyId: "abcd12345678",
    keyPreview: "flx_mcp_abcd…wxyz",
    projectIds: [PROJECT_A],
    capabilities: ["project:read", "schema:read"],
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function mockProjectDb(
  rows: Array<{ id: string; userId: string; hash: string }>,
) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => rows,
        }),
      }),
    }),
  };
}

test("normalizeCliV1Path replaces project hash segment", () => {
  assert.equal(
    normalizeCliV1Path("/api/cli/v1/projects/abc1234/backups"),
    "/api/cli/v1/projects/:hash/backups",
  );
});

test("classifyMcpCliRoute maps allowed and forbidden routes", () => {
  assert.deepEqual(classifyMcpCliRoute("/api/cli/v1/list", "GET"), {
    kind: "allowed",
    capability: "project:read",
    projectScoped: false,
  });
  assert.deepEqual(classifyMcpCliRoute("/api/cli/v1/create", "POST"), {
    kind: "forbidden",
  });
  assert.deepEqual(classifyMcpCliRoute("/api/cli/v1/projects/abc1234", "DELETE"), {
    kind: "forbidden",
  });
  assert.deepEqual(
    classifyMcpCliRoute("/api/cli/v1/projects/abc1234/backups/xyz/download", "GET"),
    { kind: "forbidden" },
  );
  assert.deepEqual(classifyMcpCliRoute("/api/cli/v1/push", "POST"), {
    kind: "allowed",
    capability: "migration:apply",
    projectScoped: false,
  });
});

test("assertMcpCapability denies missing capability", () => {
  const allowed = assertMcpCapability(mcpAuth(), "project:read");
  assert.equal(allowed.ok, true);
  const denied = assertMcpCapability(mcpAuth(), "migration:apply");
  assert.equal(denied.ok, false);
  if (denied.ok) return;
  assert.match(denied.error, /migration:apply/);
});

test("assertMcpProjectScope allows scoped project and denies out-of-scope", async () => {
  const db = mockProjectDb([{ id: PROJECT_A, userId: USER_ID, hash: HASH_A }]);
  const allowed = await assertMcpProjectScope(db as never, mcpAuth(), HASH_A);
  assert.equal(allowed.ok, true);

  const dbB = mockProjectDb([{ id: PROJECT_B, userId: USER_ID, hash: "bbb2222" }]);
  const denied = await assertMcpProjectScope(
    dbB as never,
    mcpAuth({ projectIds: [PROJECT_A] }),
    "bbb2222",
  );
  assert.equal(denied.ok, false);
  if (denied.ok) return;
  assert.equal(denied.status, 403);
});

test("assertMcpProjectScope denies another user's project", async () => {
  const db = mockProjectDb([]);
  const denied = await assertMcpProjectScope(db as never, mcpAuth(), HASH_A);
  assert.equal(denied.ok, false);
  if (denied.ok) return;
  assert.equal(denied.status, 404);
});

test("authorizeCliRoute rejects MCP token on disallowed routes", async () => {
  const issued = generateMcpToken();
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            {
              id: "row-1",
              userId: USER_ID,
              keyId: issued.keyId,
              keyPreview: issued.keyPreview,
              projectIds: [PROJECT_A],
              capabilities: ["project:read", "migration:apply"],
              expiresAt: new Date("2030-01-01T00:00:00.000Z"),
              revokedAt: null,
            },
          ],
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  };

  const denied = await authorizeCliRoute(db as never, issued.token, {
    pathname: "/api/cli/v1/create",
    method: "POST",
  });
  assert.equal(denied.ok, false);
  if (denied.ok) return;
  assert.equal(denied.status, 403);
  assert.equal(denied.code, "mcp_token_route_forbidden");
  assert.equal(denied.error.includes(issued.token), false);
});

test("authorizeCliRoute allows MCP token when capability and scope pass", async () => {
  const issued = generateMcpToken();
  let selectCalls = 0;
  const projectDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            selectCalls += 1;
            if (selectCalls === 1) {
              return [
                {
                  id: "row-1",
                  userId: USER_ID,
                  keyId: issued.keyId,
                  keyPreview: issued.keyPreview,
                  projectIds: [PROJECT_A],
                  capabilities: ["schema:read"],
                  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
                  revokedAt: null,
                },
              ];
            }
            return [{ id: PROJECT_A, hash: HASH_A }];
          },
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  };

  const allowed = await authorizeCliRoute(projectDb as never, issued.token, {
    pathname: `/api/cli/v1/projects/${HASH_A}/migrations`,
    method: "GET",
    projectHash: HASH_A,
  });
  assert.equal(allowed.ok, true);
});

test("authorizeCliRoute leaves flx_live_ CLI behavior unchanged", async () => {
  const cliKey = generateFluxCliKey();
  const cliDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: "cli-key-1", userId: USER_ID }],
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  };

  const cliAuth = await authenticateCliApiKey(cliDb as never, cliKey);
  assert.ok(cliAuth);

  const routeAuth = await authorizeCliRoute(cliDb as never, cliKey, {
    pathname: "/api/cli/v1/create",
    method: "POST",
  });
  assert.equal(routeAuth.ok, true);
  if (!routeAuth.ok) return;
  assert.equal(routeAuth.auth.keyType, "cli");
});

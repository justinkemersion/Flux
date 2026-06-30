/**
 * POST /api/agent/mcp-tokens — create scoped MCP token (show once).
 * GET /api/agent/mcp-tokens — list current user's MCP tokens (safe fields only).
 */

import { auth } from "@/src/lib/auth";
import type { SystemDb } from "@/src/lib/db";
import {
  createMcpTokenForUser,
  listMcpTokensForUser,
  parseCreateMcpTokenBody,
} from "@/src/lib/mcp-tokens";

export interface AgentMcpTokensRouteDeps {
  initSystemDb: () => Promise<void>;
  getDb: () => SystemDb;
  authenticate: () => Promise<{ user?: { id?: string | null } | null } | null>;
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

const PRIVATE_CACHE = { "Cache-Control": "private, no-store" } as const;

export async function runAgentMcpTokenCreate(
  req: Request,
  deps: AgentMcpTokensRouteDeps,
): Promise<Response> {
  const session = await deps.authenticate();
  const userId = session?.user?.id;
  if (!userId) {
    return jsonError("Unauthorized", 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const parsed = parseCreateMcpTokenBody(body);
  if (!parsed.ok) {
    return jsonError(parsed.error, 400);
  }

  await deps.initSystemDb();
  const db = deps.getDb();

  const created = await createMcpTokenForUser(db, userId, parsed.input);
  if (!created.ok) {
    return jsonError(created.error, created.status);
  }

  return Response.json(
    { token: created.token, tokenRecord: created.tokenRecord },
    { status: 201, headers: PRIVATE_CACHE },
  );
}

export async function runAgentMcpTokenList(
  _req: Request,
  deps: AgentMcpTokensRouteDeps,
): Promise<Response> {
  const session = await deps.authenticate();
  const userId = session?.user?.id;
  if (!userId) {
    return jsonError("Unauthorized", 401);
  }

  await deps.initSystemDb();
  const db = deps.getDb();

  const listed = await listMcpTokensForUser(db, userId);
  if (!listed.ok) {
    return jsonError(listed.error, listed.status);
  }

  return Response.json({ tokens: listed.tokens }, { headers: PRIVATE_CACHE });
}

export const runtime = "nodejs";

/** POST /api/agent/mcp-tokens */
export async function POST(req: Request): Promise<Response> {
  const { getDb, initSystemDb } = await import("@/src/lib/db");
  return runAgentMcpTokenCreate(req, {
    initSystemDb,
    getDb,
    authenticate: auth,
  });
}

/** GET /api/agent/mcp-tokens */
export async function GET(req: Request): Promise<Response> {
  const { getDb, initSystemDb } = await import("@/src/lib/db");
  return runAgentMcpTokenList(req, {
    initSystemDb,
    getDb,
    authenticate: auth,
  });
}

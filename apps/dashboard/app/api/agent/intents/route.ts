/**
 * GET /api/agent/intents — session-authenticated MCP intent list (read-only).
 */

import { auth } from "@/src/lib/auth";
import type { SystemDb } from "@/src/lib/db";
import { listMcpIntentsForUser, parseListMcpIntentsQuery } from "@/src/lib/mcp-intents";

export interface AgentIntentListRouteDeps {
  initSystemDb: () => Promise<void>;
  getDb: () => SystemDb;
  authenticate: () => Promise<{ user?: { id?: string | null } | null } | null>;
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function runAgentIntentList(
  req: Request,
  deps: AgentIntentListRouteDeps,
): Promise<Response> {
  const session = await deps.authenticate();
  const userId = session?.user?.id;
  if (!userId) {
    return jsonError("Unauthorized", 401);
  }

  await deps.initSystemDb();
  const db = deps.getDb();

  const parsed = parseListMcpIntentsQuery(new URL(req.url).searchParams);
  if (!parsed.ok) {
    return jsonError(parsed.error, 400);
  }

  const listed = await listMcpIntentsForUser(db, userId, parsed.filters);
  if (!listed.ok) {
    return jsonError(listed.error, listed.status);
  }

  return Response.json(listed.result, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export const runtime = "nodejs";

/** GET /api/agent/intents */
export async function GET(req: Request): Promise<Response> {
  const { getDb, initSystemDb } = await import("@/src/lib/db");
  return runAgentIntentList(req, {
    initSystemDb,
    getDb,
    authenticate: auth,
  });
}

/**
 * DELETE /api/agent/mcp-tokens/:id — revoke scoped MCP token (soft revoke).
 */

import { auth } from "@/src/lib/auth";
import type { SystemDb } from "@/src/lib/db";
import { revokeMcpTokenForUser } from "@/src/lib/mcp-tokens";

export interface AgentMcpTokenRevokeRouteDeps {
  initSystemDb: () => Promise<void>;
  getDb: () => SystemDb;
  authenticate: () => Promise<{ user?: { id?: string | null } | null } | null>;
}

type Ctx = { params: Promise<{ id: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function runAgentMcpTokenRevoke(
  _req: Request,
  tokenId: string,
  deps: AgentMcpTokenRevokeRouteDeps,
): Promise<Response> {
  const session = await deps.authenticate();
  const userId = session?.user?.id;
  if (!userId) {
    return jsonError("Unauthorized", 401);
  }

  await deps.initSystemDb();
  const db = deps.getDb();

  const revoked = await revokeMcpTokenForUser(db, userId, tokenId);
  if (!revoked.ok) {
    return jsonError(revoked.error, revoked.status);
  }

  return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}

export const runtime = "nodejs";

/** DELETE /api/agent/mcp-tokens/:id */
export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const { getDb, initSystemDb } = await import("@/src/lib/db");
  return runAgentMcpTokenRevoke(_req, id, {
    initSystemDb,
    getDb,
    authenticate: auth,
  });
}

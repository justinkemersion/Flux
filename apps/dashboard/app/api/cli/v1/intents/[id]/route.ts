/**
 * GET /api/cli/v1/intents/:id — fetch a persisted MCP intent owned by the caller.
 */

import { authenticateCliApiKey, extractBearerToken } from "@/src/lib/cli-api-auth";
import type { SystemDb } from "@/src/lib/db";
import { getMcpIntentById } from "@/src/lib/mcp-intents";

export interface CliIntentGetRouteDeps {
  initSystemDb: () => Promise<void>;
  getDb: () => SystemDb;
  authenticate: typeof authenticateCliApiKey;
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

type Ctx = { params: Promise<{ id: string }> };

export async function runCliIntentGet(
  req: Request,
  context: Ctx,
  deps: CliIntentGetRouteDeps,
): Promise<Response> {
  await deps.initSystemDb();
  const db = deps.getDb();
  const secret = extractBearerToken(req.headers.get("authorization"));
  const auth = await deps.authenticate(db, secret);
  if (!auth) {
    return jsonError("Unauthorized", 401);
  }

  const { id } = await context.params;
  const result = await getMcpIntentById(db, auth, id ?? "");
  if (!result.ok) {
    return jsonError(result.error, result.status);
  }

  return Response.json(result.intent, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export const runtime = "nodejs";

/** GET /api/cli/v1/intents/:id */
export async function GET(req: Request, context: Ctx): Promise<Response> {
  const { getDb, initSystemDb } = await import("@/src/lib/db");
  const { authenticateCliApiKey } = await import("@/src/lib/cli-api-auth");
  return runCliIntentGet(req, context, {
    initSystemDb,
    getDb,
    authenticate: authenticateCliApiKey,
  });
}

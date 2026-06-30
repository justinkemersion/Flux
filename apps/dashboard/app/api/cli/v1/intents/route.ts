/**
 * POST /api/cli/v1/intents — persist MCP agent intents.
 * GET /api/cli/v1/intents — list MCP intents for the authenticated CLI user (read-only).
 */

import { extractBearerToken } from "@/src/lib/cli-api-auth";
import { controlPlaneAuthIdentity } from "@/src/lib/control-plane-auth";
import type { SystemDb } from "@/src/lib/db";
import {
  insertMcpIntent,
  listMcpIntentsForUser,
  parseListMcpIntentsQuery,
  validateMcpIntentInput,
} from "@/src/lib/mcp-intents";
import {
  authorizeCliRoute,
  cliRouteAuthJsonError,
  enforceControlPlaneProjectScope,
} from "@/src/lib/mcp-route-auth";

export interface CliIntentRouteDeps {
  initSystemDb: () => Promise<void>;
  getDb: () => SystemDb;
  authorizeCliRoute?: typeof authorizeCliRoute;
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function runCliIntentGet(
  req: Request,
  deps: CliIntentRouteDeps,
): Promise<Response> {
  await deps.initSystemDb();
  const db = deps.getDb();
  const secret = extractBearerToken(req.headers.get("authorization"));
  const authorize = deps.authorizeCliRoute ?? authorizeCliRoute;
  const authResult = await authorize(db, secret, {
    pathname: new URL(req.url).pathname,
    method: "GET",
  });
  if (!authResult.ok) {
    return cliRouteAuthJsonError(authResult);
  }
  const auth = authResult.auth;

  const parsed = parseListMcpIntentsQuery(new URL(req.url).searchParams);
  if (!parsed.ok) {
    return jsonError(parsed.error, 400);
  }

  const listed = await listMcpIntentsForUser(db, auth.userId, parsed.filters);
  if (!listed.ok) {
    return jsonError(listed.error, listed.status);
  }

  return Response.json(listed.result, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function runCliIntentPost(
  req: Request,
  deps: CliIntentRouteDeps,
): Promise<Response> {
  await deps.initSystemDb();
  const db = deps.getDb();
  const secret = extractBearerToken(req.headers.get("authorization"));
  const authorize = deps.authorizeCliRoute ?? authorizeCliRoute;
  const authResult = await authorize(db, secret, {
    pathname: new URL(req.url).pathname,
    method: "POST",
  });
  if (!authResult.ok) {
    return cliRouteAuthJsonError(authResult);
  }
  const auth = authResult.auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const validated = validateMcpIntentInput(body);
  if (!validated.ok) {
    return jsonError(validated.error, 400);
  }

  const project = await enforceControlPlaneProjectScope(
    db,
    auth,
    validated.input.projectHash,
    validated.input.projectId,
  );
  if (!project.ok) {
    return jsonError(project.error, project.status);
  }

  const inserted = await insertMcpIntent(
    db,
    auth,
    validated.input,
    project.projectId,
  );
  if (!inserted.ok) {
    return jsonError(inserted.error, inserted.status);
  }

  return Response.json(
    { intentId: inserted.intentId, status: inserted.status },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export const runtime = "nodejs";

/** GET /api/cli/v1/intents */
export async function GET(req: Request): Promise<Response> {
  const { getDb, initSystemDb } = await import("@/src/lib/db");
  return runCliIntentGet(req, {
    initSystemDb,
    getDb,
  });
}

/** POST /api/cli/v1/intents */
export async function POST(req: Request): Promise<Response> {
  const { getDb, initSystemDb } = await import("@/src/lib/db");
  return runCliIntentPost(req, {
    initSystemDb,
    getDb,
  });
}

/**
 * GET /api/cli/v1/intents/:id — fetch a persisted MCP intent owned by the caller.
 * PATCH /api/cli/v1/intents/:id — update terminal intent state after tool execution.
 */

import { extractBearerToken } from "@/src/lib/cli-api-auth";
import { controlPlaneAuthIdentity, isMcpControlPlaneAuth } from "@/src/lib/control-plane-auth";
import type { SystemDb } from "@/src/lib/db";
import {
  getMcpIntentById,
  updateMcpIntentById,
  validateMcpIntentUpdateInput,
} from "@/src/lib/mcp-intents";
import { authorizeCliRoute, cliRouteAuthJsonError } from "@/src/lib/mcp-route-auth";

export interface CliIntentIdRouteDeps {
  initSystemDb: () => Promise<void>;
  getDb: () => SystemDb;
  authorizeCliRoute?: typeof authorizeCliRoute;
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

type Ctx = { params: Promise<{ id: string }> };

export async function runCliIntentGet(
  req: Request,
  context: Ctx,
  deps: CliIntentIdRouteDeps,
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
  const auth = controlPlaneAuthIdentity(authResult.auth);
  const scopeOptions = isMcpControlPlaneAuth(authResult.auth)
    ? { allowedProjectIds: authResult.auth.projectIds }
    : undefined;

  const { id } = await context.params;
  const result = await getMcpIntentById(db, auth, id ?? "", scopeOptions);
  if (!result.ok) {
    return jsonError(result.error, result.status);
  }

  return Response.json(result.intent, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function runCliIntentPatch(
  req: Request,
  context: Ctx,
  deps: CliIntentIdRouteDeps,
): Promise<Response> {
  await deps.initSystemDb();
  const db = deps.getDb();
  const secret = extractBearerToken(req.headers.get("authorization"));
  const authorize = deps.authorizeCliRoute ?? authorizeCliRoute;
  const authResult = await authorize(db, secret, {
    pathname: new URL(req.url).pathname,
    method: "PATCH",
  });
  if (!authResult.ok) {
    return cliRouteAuthJsonError(authResult);
  }
  const auth = controlPlaneAuthIdentity(authResult.auth);
  const scopeOptions = isMcpControlPlaneAuth(authResult.auth)
    ? { allowedProjectIds: authResult.auth.projectIds }
    : undefined;

  const { id } = await context.params;
  const intentId = id ?? "";
  const existing = await getMcpIntentById(db, auth, intentId, scopeOptions);
  if (!existing.ok) {
    return jsonError(existing.error, existing.status);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const validated = validateMcpIntentUpdateInput(body);
  if (!validated.ok) {
    return jsonError(validated.error, 400);
  }

  const updated = await updateMcpIntentById(
    db,
    auth,
    intentId,
    validated.input,
    scopeOptions,
  );
  if (!updated.ok) {
    return jsonError(updated.error, updated.status);
  }

  return Response.json(
    { intentId: updated.intentId, status: updated.status },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export const runtime = "nodejs";

/** GET /api/cli/v1/intents/:id */
export async function GET(req: Request, context: Ctx): Promise<Response> {
  const { getDb, initSystemDb } = await import("@/src/lib/db");
  return runCliIntentGet(req, context, {
    initSystemDb,
    getDb,
  });
}

/** PATCH /api/cli/v1/intents/:id */
export async function PATCH(req: Request, context: Ctx): Promise<Response> {
  const { getDb, initSystemDb } = await import("@/src/lib/db");
  return runCliIntentPatch(req, context, {
    initSystemDb,
    getDb,
  });
}

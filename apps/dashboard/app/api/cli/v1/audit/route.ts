/**
 * POST /api/cli/v1/audit — persist MCP tool-call audit events.
 */

import { extractBearerToken } from "@/src/lib/cli-api-auth";
import { controlPlaneAuthIdentity } from "@/src/lib/control-plane-auth";
import type { SystemDb } from "@/src/lib/db";
import {
  insertMcpAuditEvent,
  validateMcpAuditEventInput,
} from "@/src/lib/mcp-audit";
import { enforceControlPlaneProjectScope, authorizeCliRoute, cliRouteAuthJsonError } from "@/src/lib/mcp-route-auth";

export interface CliAuditRouteDeps {
  initSystemDb: () => Promise<void>;
  getDb: () => SystemDb;
  authorizeCliRoute?: typeof authorizeCliRoute;
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function runCliAuditPost(
  req: Request,
  deps: CliAuditRouteDeps,
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

  const validated = validateMcpAuditEventInput(body);
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

  const inserted = await insertMcpAuditEvent(
    db,
    controlPlaneAuthIdentity(auth),
    validated.input,
    project.projectId,
  );
  if (!inserted.ok) {
    return jsonError(inserted.error, inserted.status);
  }

  return Response.json(
    { ok: true, auditId: inserted.auditId },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export const runtime = "nodejs";

/** POST /api/cli/v1/audit */
export async function POST(req: Request): Promise<Response> {
  const { getDb, initSystemDb } = await import("@/src/lib/db");
  return runCliAuditPost(req, {
    initSystemDb,
    getDb,
  });
}

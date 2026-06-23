import { FLUX_PROJECT_HASH_HEX_LEN } from "@flux/core";
import {
  PROJECT_LIFECYCLE_ACTIONS,
  type ProjectLifecycleAction,
} from "@flux/core/project-lifecycle-state";
import {
  authenticateCliApiKey,
  extractBearerToken,
} from "@/src/lib/cli-api-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import {
  applyProjectLifecycleActionByHash,
  loadProjectLifecycleByHash,
} from "@/src/lib/project-lifecycle-state";

export const runtime = "nodejs";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function isValidHash(h: string): boolean {
  return (
    h.length === FLUX_PROJECT_HASH_HEX_LEN && /^[a-f0-9]+$/u.test(h)
  );
}

type Ctx = { params: Promise<{ hash: string }> };

function parseAction(raw: unknown): ProjectLifecycleAction | null {
  if (!raw || typeof raw !== "object" || !("action" in raw)) return null;
  const action = (raw as { action: unknown }).action;
  if (
    typeof action === "string" &&
    (PROJECT_LIFECYCLE_ACTIONS as readonly string[]).includes(action)
  ) {
    return action as ProjectLifecycleAction;
  }
  return null;
}

/**
 * GET /api/cli/v1/projects/:hash/lifecycle-state
 */
export async function GET(
  req: Request,
  context: Ctx,
): Promise<Response> {
  await initSystemDb();
  const db = getDb();
  const secret = extractBearerToken(req.headers.get("authorization"));
  const auth = await authenticateCliApiKey(db, secret);
  if (!auth) {
    return jsonError("Unauthorized", 401);
  }

  const { hash: paramHash } = await context.params;
  const hash = (paramHash ?? "").trim().toLowerCase();
  if (!isValidHash(hash)) {
    return jsonError(
      `hash in path must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-char hex id`,
      400,
    );
  }

  const lifecycle = await loadProjectLifecycleByHash(db, {
    hash,
    userId: auth.userId,
  });
  if (!lifecycle) return jsonError("Project not found", 404);

  return Response.json(
    { lifecycle },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * POST /api/cli/v1/projects/:hash/lifecycle-state
 * Body: { "action": "wake" | "sleep" | "archive" }
 */
export async function POST(
  req: Request,
  context: Ctx,
): Promise<Response> {
  await initSystemDb();
  const db = getDb();
  const secret = extractBearerToken(req.headers.get("authorization"));
  const auth = await authenticateCliApiKey(db, secret);
  if (!auth) {
    return jsonError("Unauthorized", 401);
  }

  const { hash: paramHash } = await context.params;
  const hash = (paramHash ?? "").trim().toLowerCase();
  if (!isValidHash(hash)) {
    return jsonError(
      `hash in path must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-char hex id`,
      400,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const action = parseAction(body);
  if (!action) {
    return jsonError(
      'Expected JSON: { "action": "wake" | "sleep" | "archive" }',
      400,
    );
  }

  const result = await applyProjectLifecycleActionByHash({
    db,
    hash,
    userId: auth.userId,
    action,
  });
  if ("error" in result) {
    return jsonError(result.error, result.status);
  }

  return Response.json({
    ok: true,
    action,
    lifecycleState: result.lifecycleState,
    noop: result.noop === true,
  });
}

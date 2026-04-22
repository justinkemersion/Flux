import { FLUX_PROJECT_HASH_HEX_LEN } from "@flux/core";
import {
  authenticateCliApiKey,
  extractBearerToken,
} from "@/src/lib/cli-api-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import { applyProjectPowerActionByHash } from "@/src/lib/project-lifecycle";

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

const lifecycleBodySchema = (raw: unknown): { action: "start" | "stop" } | null => {
  if (!raw || typeof raw !== "object" || !("action" in raw)) {
    return null;
  }
  const a = (raw as { action: unknown }).action;
  if (a === "start" || a === "stop") {
    return { action: a };
  }
  return null;
};

/**
 * POST /api/cli/v1/projects/:hash/lifecycle
 * Body: { "action": "start" | "stop" }
 * Bearer CLI key, ownership by catalog (user, hash).
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

  const parsed = lifecycleBodySchema(body);
  if (!parsed) {
    return jsonError('Expected JSON: { "action": "start" | "stop" }', 400);
  }

  const result = await applyProjectPowerActionByHash({
    hash,
    userId: auth.userId,
    action: parsed.action,
  });
  if ("error" in result) {
    return jsonError(result.error, result.status);
  }
  return Response.json({ ok: true, action: parsed.action });
}

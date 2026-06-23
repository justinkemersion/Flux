import type { NextRequest } from "next/server";
import {
  PROJECT_LIFECYCLE_ACTIONS,
  type ProjectLifecycleAction,
} from "@flux/core/project-lifecycle-state";
import { auth } from "@/src/lib/auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import {
  applyProjectLifecycleAction,
  loadOwnedProjectLifecycle,
} from "@/src/lib/project-lifecycle-state";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function parseHash(req: NextRequest): string | null {
  const hash = req.nextUrl.searchParams.get("hash")?.trim().toLowerCase() ?? "";
  if (!/^[a-f0-9]{7}$/u.test(hash)) return null;
  return hash;
}

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
 * GET /api/projects/[slug]/lifecycle?hash=<7hex>
 */
export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const hash = parseHash(req);
  if (!hash) return jsonError("Missing or invalid hash query param", 400);

  const { slug } = await ctx.params;
  await initSystemDb();
  const db = getDb();
  const lifecycle = await loadOwnedProjectLifecycle(db, {
    slug,
    hash,
    userId: session.user.id,
  });
  if (!lifecycle) return jsonError("Project not found", 404);

  return Response.json(
    { lifecycle },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * POST /api/projects/[slug]/lifecycle?hash=<7hex>
 * Body: { "action": "wake" | "sleep" | "archive" }
 */
export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const hash = parseHash(req);
  if (!hash) return jsonError("Missing or invalid hash query param", 400);

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

  const { slug } = await ctx.params;
  await initSystemDb();
  const db = getDb();
  const result = await applyProjectLifecycleAction({
    db,
    slug,
    userId: session.user.id,
    action,
  });
  if ("error" in result) {
    return jsonError(result.error, result.status);
  }

  const lifecycle = await loadOwnedProjectLifecycle(db, {
    slug,
    hash,
    userId: session.user.id,
  });

  return Response.json({
    ok: true,
    action,
    lifecycleState: result.lifecycleState,
    noop: result.noop === true,
    lifecycle,
  });
}

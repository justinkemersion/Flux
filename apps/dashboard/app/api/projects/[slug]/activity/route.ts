import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { projects } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
} as const;

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: CORS_HEADERS });
}

/**
 * OPTIONS /api/projects/[slug]/activity — CORS preflight for SDK/browser bumps.
 */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * POST /api/projects/[slug]/activity
 * Updates `last_accessed_at` for the catalog row. Secured with
 * `Authorization: Bearer <FLUX_ACTIVITY_SECRET>` (same secret the SDK sends).
 * Not for end-user session auth — use a shared secret between app server and dashboard.
 */
export async function POST(
  _req: NextRequest,
  ctx: Ctx,
): Promise<Response> {
  const secret = process.env.FLUX_ACTIVITY_SECRET?.trim();
  if (!secret) {
    return jsonError(
      "Activity endpoint is not configured (set FLUX_ACTIVITY_SECRET).",
      503,
    );
  }

  const auth = _req.headers.get("authorization");
  const token =
    auth?.startsWith("Bearer ") === true
      ? auth.slice("Bearer ".length).trim()
      : "";
  if (token !== secret) {
    return jsonError("Unauthorized", 401);
  }

  const { slug } = await ctx.params;
  if (slug === "flux-system") {
    return jsonError("Cannot bump flux-system via this endpoint.", 400);
  }

  await initSystemDb();
  const db = getDb();

  const updated = await db
    .update(projects)
    .set({ lastAccessedAt: new Date() })
    .where(eq(projects.slug, slug))
    .returning({ id: projects.id });

  if (updated.length === 0) {
    return jsonError("Project not found", 404);
  }

  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

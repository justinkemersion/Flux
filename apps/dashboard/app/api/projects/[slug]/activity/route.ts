import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
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
 * POST /api/projects/[slug]/activity?hash=<7hex>
 *
 * Updates `last_accessed_at` for the `(slug, hash)` catalog row. Secured with
 * `Authorization: Bearer <FLUX_ACTIVITY_SECRET>` (the same secret the SDK sends).
 * The `hash` query param is required because under global hash namespacing the
 * `slug` alone is no longer unique across users — it's only unique **per user**
 * thanks to the `(userId, slug)` composite index. The SDK infers `hash` from the
 * tenant URL (`api.{slug}.{hash}.{domain}`), so this is transparent to callers.
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

  const url = new URL(_req.url);
  const hash = url.searchParams.get("hash")?.trim() ?? "";
  if (!/^[a-f0-9]{7}$/i.test(hash)) {
    return jsonError(
      "Missing or invalid hash query param. Expected ?hash=<7-hex>. " +
        "Upgrade to an SDK that infers the hash from the tenant URL.",
      400,
    );
  }

  await initSystemDb();
  const db = getDb();

  const updated = await db
    .update(projects)
    .set({ lastAccessedAt: new Date() })
    .where(and(eq(projects.slug, slug), eq(projects.hash, hash)))
    .returning({ id: projects.id });

  if (updated.length === 0) {
    return jsonError("Project not found", 404);
  }

  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

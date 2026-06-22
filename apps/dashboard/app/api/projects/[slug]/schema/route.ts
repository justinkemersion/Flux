import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { auth } from "@/src/lib/auth";
import { projects } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";
import { inspectProjectSchema } from "@/src/lib/project-schema-inspection";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * GET /api/projects/[slug]/schema
 * Read-only schema inspection for dashboard clients (browser session auth).
 *
 * Returns a SchemaInspectionResult. The admin DB credentials used for v2
 * inspection are never included in the response — the result is pure metadata.
 *
 * Query params:
 *   ?hash=<7hex>  required — prevents serving stale data after hash change
 */
export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const { slug } = await ctx.params;
  const hash = req.nextUrl.searchParams.get("hash")?.trim().toLowerCase() ?? "";
  if (!hash) {
    return jsonError("Missing required query param: hash", 400);
  }

  await initSystemDb();
  const db = getDb();

  const [project] = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      hash: projects.hash,
      mode: projects.mode,
      apiSchemaName: projects.apiSchemaName,
      apiSchemaStrategy: projects.apiSchemaStrategy,
    })
    .from(projects)
    .where(
      and(
        eq(projects.slug, slug),
        eq(projects.hash, hash),
        eq(projects.userId, session.user.id),
      ),
    )
    .limit(1);

  if (!project) {
    return jsonError("Project not found", 404);
  }

  try {
    const result = await inspectProjectSchema(project);
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found|not running|No Postgres container/i.test(msg)) {
      return jsonError(msg, 400);
    }
    return jsonError(msg, 500);
  }
}

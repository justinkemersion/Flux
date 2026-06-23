import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { auth } from "@/src/lib/auth";
import { projects } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";
import { listProjectActivityEvents } from "@/src/lib/project-activity";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * GET /api/projects/[slug]/timeline?hash=<7hex>&limit=50
 *
 * Session auth: recent project timeline events (newest first).
 */
export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const { slug } = await ctx.params;
  const hash = req.nextUrl.searchParams.get("hash")?.trim().toLowerCase() ?? "";
  if (!/^[a-f0-9]{7}$/u.test(hash)) {
    return jsonError("Missing or invalid hash query param", 400);
  }

  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 50;

  await initSystemDb();
  const db = getDb();
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.slug, slug),
        eq(projects.hash, hash),
        eq(projects.userId, session.user.id),
      ),
    )
    .limit(1);

  if (!project) return jsonError("Project not found", 404);

  const events = await listProjectActivityEvents(db, project.id, limit);
  return Response.json(
    { events },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

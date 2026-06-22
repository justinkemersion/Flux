import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { auth } from "@/src/lib/auth";
import { projects } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";
import { runProjectDoctor } from "@/src/lib/project-doctor";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * GET /api/projects/[slug]/doctor?hash=<7hex>
 * Runs all project health checks and returns a DoctorReport.
 * Auth: browser session.
 */
export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const { slug } = await ctx.params;
  const hash = req.nextUrl.searchParams.get("hash")?.trim().toLowerCase() ?? "";
  if (!hash) return jsonError("Missing required query param: hash", 400);

  await initSystemDb();
  const db = getDb();

  const [project] = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      hash: projects.hash,
      mode: projects.mode,
      jwtSecret: projects.jwtSecret,
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

  if (!project) return jsonError("Project not found", 404);

  try {
    const report = await runProjectDoctor(project);
    return Response.json(report, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(msg, 500);
  }
}

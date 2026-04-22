import { and, desc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { auth } from "@/src/lib/auth";
import { projectHeartbeatLog, projects } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * GET /api/projects/[slug]/history
 * Last 20 mesh probe samples (newest first).
 */
export async function GET(
  _req: NextRequest,
  ctx: Ctx,
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const { slug } = await ctx.params;

  await initSystemDb();
  const db = getDb();
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(eq(projects.slug, slug), eq(projects.userId, session.user.id)),
    )
    .limit(1);
  if (!project) {
    return jsonError("Project not found", 404);
  }

  const rows = await db
    .select({
      recordedAt: projectHeartbeatLog.recordedAt,
      healthStatus: projectHeartbeatLog.healthStatus,
    })
    .from(projectHeartbeatLog)
    .where(eq(projectHeartbeatLog.projectId, project.id))
    .orderBy(desc(projectHeartbeatLog.recordedAt))
    .limit(20);

  return Response.json({
    entries: rows.map((r) => ({
      recordedAt: r.recordedAt.toISOString(),
      healthStatus: r.healthStatus,
    })),
  });
}

import type { NextRequest } from "next/server";
import { auth } from "@/src/lib/auth";
import { projects } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getProjectManager } from "@/src/lib/flux";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

async function resolveOwnedProject(slug: string, userId: string) {
  const db = getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.slug, slug), eq(projects.userId, userId)));
  return project ?? null;
}

/**
 * GET /api/projects/[slug]/logs?service=api|db
 * Tail of Docker logs for the tenant PostgREST or Postgres container.
 */
export async function GET(
  req: NextRequest,
  ctx: Ctx,
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const { slug } = await ctx.params;
  const service = req.nextUrl.searchParams.get("service") ?? "api";
  if (service !== "api" && service !== "db") {
    return jsonError('service must be "api" or "db"', 400);
  }

  await initSystemDb();
  const project = await resolveOwnedProject(slug, session.user.id);
  if (!project) return jsonError("Project not found", 404);

  const pm = getProjectManager();
  try {
    const logs = await pm.getTenantContainerLogs(
      slug,
      project.hash,
      service === "api" ? "api" : "db",
      { tail: 400 },
    );
    return Response.json({ logs, service });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(`Logs unavailable: ${msg}`, 503);
  }
}

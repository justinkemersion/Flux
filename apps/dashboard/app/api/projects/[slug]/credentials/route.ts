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

/**
 * GET /api/projects/[slug]/credentials
 * Returns Postgres host URI and anon/service JWT keys for the project owner only.
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
    .select()
    .from(projects)
    .where(and(eq(projects.slug, slug), eq(projects.userId, session.user.id)));

  if (!project) return jsonError("Project not found", 404);

  if (project.mode === "v2_shared") {
    return jsonError(
      "Credentials for v2_shared tenants are not exposed here: there is no per-tenant PostgREST container or Docker Postgres superuser. Use the public API URL with JWTs from the Flux gateway (or your app’s auth flow).",
      501,
    );
  }

  const pm = getProjectManager();
  try {
    const credentials = await pm.getProjectCredentials(slug, project.hash);
    return Response.json(credentials);
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

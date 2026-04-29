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
    if (!project.jwtSecret) {
      return jsonError(
        "Project jwt_secret is not set yet. Run POST /api/projects/[slug]/repair once.",
        503,
      );
    }
    return Response.json({
      mode: "v2_shared",
      projectJwtSecret: project.jwtSecret,
      note:
        "Sign HS256 JWTs with projectJwtSecret; the gateway verifies them per Host. " +
        "Gateway→PostgREST uses the pool FLUX_GATEWAY_JWT_SECRET (not this value). There is no per-tenant Docker Postgres URI in pooled mode.",
    });
  }

  const pm = getProjectManager();
  try {
    const credentials = await pm.getProjectCredentials(slug, project.hash);
    return Response.json(credentials);
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

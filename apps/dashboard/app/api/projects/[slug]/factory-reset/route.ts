import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/src/lib/auth";
import { projects } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getProjectManager } from "@/src/lib/flux";
import { dispatchProvisionProject } from "@/src/lib/provisioning-engine";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * POST /api/projects/[slug]/factory-reset
 * Destructive reset for v1 dedicated projects: removes API/DB containers + data volume,
 * then reprovisions an empty stack for the same slug/hash.
 */
export async function POST(
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
  if (project.mode !== "v1_dedicated") {
    return jsonError(
      "Factory reset is only supported for v1_dedicated projects.",
      400,
    );
  }

  const pm = getProjectManager();
  try {
    await pm.nukeContainersOnly(slug, project.hash);
    await pm.removeTenantPrivateNetworkAllowMissing(slug, project.hash);
    const provisioned = await dispatchProvisionProject({
      mode: project.mode,
      projectName: project.name,
      projectHash: project.hash,
      tenantId: project.id,
      projectManager: pm,
      isProduction: process.env.NODE_ENV === "production",
    });
    return Response.json({
      ok: true,
      apiUrl: provisioned.apiUrl,
      slug: provisioned.slug,
      mode: project.mode,
    });
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

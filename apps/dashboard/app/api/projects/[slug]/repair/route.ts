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
 * POST /api/projects/[slug]/repair
 * Nukes any leftover Docker resources for the slug and reprovisions a fresh stack.
 * Irreversible data loss if a volume still existed.
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

  const pm = getProjectManager();
  try {
    if (project.mode === "v1_dedicated") {
      // Nuke already removes the private network; second call is an idempotent safety net
      // if Docker left a stale user-defined network (disconnect-all + remove).
      await pm.nukeContainersOnly(slug, project.hash);
      await pm.removeTenantPrivateNetworkAllowMissing(slug, project.hash);
    }
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

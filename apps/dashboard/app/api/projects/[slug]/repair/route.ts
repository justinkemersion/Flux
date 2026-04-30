import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/src/lib/auth";
import { projects } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getProjectManager } from "@/src/lib/flux";
import {
  dispatchProvisionProject,
  generateProjectJwtSecret,
} from "@/src/lib/provisioning-engine";
import {
  evictHostnames,
  v2SharedGatewayCacheHostnames,
} from "@/src/lib/gateway-cache";
import { fluxApiUrlForSlug } from "@flux/core";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * POST /api/projects/[slug]/repair
 * Reconciles tenant infrastructure in place (non-destructive) and reprovisions
 * missing pieces. For v1, this preserves the Postgres volume/data.
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

  let row = project;
  if (!row.jwtSecret) {
    const secret = generateProjectJwtSecret();
    await db
      .update(projects)
      .set({ jwtSecret: secret })
      .where(eq(projects.id, row.id));
    row = { ...row, jwtSecret: secret };
    const isProd = process.env.NODE_ENV === "production";
    if (row.mode === "v2_shared") {
      await evictHostnames(
        v2SharedGatewayCacheHostnames(row.slug, row.hash, isProd),
      );
    } else {
      await evictHostnames([
        new URL(fluxApiUrlForSlug(row.slug, row.hash, isProd)).hostname,
      ]);
    }
  }

  const catalogJwtSecret = row.jwtSecret;
  if (!catalogJwtSecret) {
    return jsonError(
      "Project jwt_secret is missing and could not be allocated.",
      500,
    );
  }

  const pm = getProjectManager();
  try {
    // v1_dedicated intentionally does not nuke containers/volumes here:
    // provisionProject() already adopts existing containers, starts stopped ones,
    // and recreates missing pieces while preserving tenant data volumes.
    const provisioned = await dispatchProvisionProject({
      mode: row.mode,
      projectName: row.name,
      projectHash: row.hash,
      tenantId: row.id,
      projectManager: pm,
      isProduction: process.env.NODE_ENV === "production",
      reuseProjectJwtSecret: catalogJwtSecret,
    });
    return Response.json({
      ok: true,
      apiUrl: provisioned.apiUrl,
      slug: provisioned.slug,
      mode: row.mode,
      /** Same value as `projects.jwt_secret` — paste as `FLUX_GATEWAY_JWT_SECRET` in your app/gateway `.env`. */
      projectJwtSecret: catalogJwtSecret,
    });
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

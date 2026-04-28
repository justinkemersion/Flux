import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { auth } from "@/src/lib/auth";
import { domains, projects } from "@/src/db/schema";
import { fluxApiUrlForSlug } from "@flux/core";
import { deprovisionProject } from "@flux/engine-v2";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getProjectManager } from "@/src/lib/flux";
import { applyProjectPowerAction } from "@/src/lib/project-lifecycle";
import { evictHostnames } from "@/src/lib/gateway-cache";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/** Resolves the project by slug and verifies the session user owns it. */
async function resolveOwnedProject(slug: string, userId: string) {
  const db = getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.slug, slug), eq(projects.userId, userId)));
  return project ?? null;
}

/**
 * GET /api/projects/[slug]
 * Returns live status and API URL for a single project (no DB URI or JWT keys — use
 * GET /api/projects/[slug]/credentials).
 */
export async function GET(
  _req: NextRequest,
  ctx: Ctx,
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const { slug } = await ctx.params;

  await initSystemDb();
  const project = await resolveOwnedProject(slug, session.user.id);
  if (!project) return jsonError("Project not found", 404);

  const pm = getProjectManager();
  let summary: Awaited<
    ReturnType<typeof pm.getProjectSummariesForSlugs>
  >[number] | undefined;
  try {
    const rows = await pm.getProjectSummariesForSlugs(
      [{ slug, hash: project.hash }],
      { isProduction: process.env.NODE_ENV === "production" },
    );
    summary = rows[0];
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(`Docker status unavailable: ${msg}`, 503);
  }

  return Response.json({
    id: project.id,
    name: project.name,
    slug: project.slug,
    status: summary?.status ?? "missing",
    apiUrl:
      summary?.apiUrl ??
      fluxApiUrlForSlug(
        slug,
        project.hash,
        process.env.NODE_ENV === "production",
      ),
    createdAt: project.createdAt,
    healthStatus: project.healthStatus ?? null,
    lastHeartbeatAt: project.lastHeartbeatAt
      ? project.lastHeartbeatAt.toISOString()
      : null,
  });
}

/**
 * PUT /api/projects/[slug]
 * Body: { action: "start" | "stop" }
 * Starts or stops the project's Postgres and PostgREST containers.
 */
export async function PUT(
  req: NextRequest,
  ctx: Ctx,
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const { slug } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("action" in body) ||
    typeof (body as { action: unknown }).action !== "string"
  ) {
    return jsonError('Expected JSON body with an "action" field', 400);
  }

  const action = (body as { action: string }).action;
  if (action !== "start" && action !== "stop") {
    return jsonError('action must be "start" or "stop"', 400);
  }

  await initSystemDb();
  const project = await resolveOwnedProject(slug, session.user.id);
  if (!project) return jsonError("Project not found", 404);

  const result = await applyProjectPowerAction({
    slug,
    userId: session.user.id,
    action,
  });
  if ("error" in result) {
    return jsonError(result.error, result.status);
  }
  return Response.json({ ok: true, action });
}

/**
 * PATCH /api/projects/[slug]
 * Body: { jwtSecret: string } — updates PostgREST `PGRST_JWT_SECRET` and recreates the API container.
 */
export async function PATCH(
  req: NextRequest,
  ctx: Ctx,
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const { slug } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("jwtSecret" in body) ||
    typeof (body as { jwtSecret: unknown }).jwtSecret !== "string"
  ) {
    return jsonError('Expected JSON body with a string "jwtSecret" field', 400);
  }

  const jwtSecret = (body as { jwtSecret: string }).jwtSecret.trim();
  if (!jwtSecret) {
    return jsonError("jwtSecret cannot be empty", 400);
  }

  await initSystemDb();
  const project = await resolveOwnedProject(slug, session.user.id);
  if (!project) return jsonError("Project not found", 404);

  const pm = getProjectManager();
  try {
    await pm.updatePostgrestJwtSecret(slug, jwtSecret, project.hash);
    return Response.json({ ok: true });
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

/**
 * DELETE /api/projects/[slug]
 * Verifies ownership, tears down all project infrastructure, evicts gateway
 * hostname caches to prevent zombie routing, then deletes the DB record.
 * This is irreversible.
 *
 * Cache eviction contract:
 *   All custom-domain hostnames associated with the project are evicted from
 *   the gateway Redis cache BEFORE the DB row is deleted.  The DB delete then
 *   cascade-removes all domain rows.  If eviction fails (Redis down) we still
 *   proceed — the gateway TTL bounds the zombie-routing window to ≤60 s.
 */
export async function DELETE(
  _req: NextRequest,
  ctx: Ctx,
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const { slug } = await ctx.params;

  await initSystemDb();
  const db = getDb();
  const project = await resolveOwnedProject(slug, session.user.id);
  if (!project) return jsonError("Project not found", 404);

  // 1. Collect all custom-domain hostnames before deleting anything.
  //    We need them for cache eviction; the cascade-delete will remove the rows.
  const projectDomains = await db
    .select({ hostname: domains.hostname })
    .from(domains)
    .where(eq(domains.projectId, project.id));
  const hostnames = projectDomains.map((d) => d.hostname);

  try {
    // 2. Evict gateway hostname caches (fail-open) to prevent zombie routing.
    await evictHostnames(hostnames);

    if (project.mode === "v2_shared") {
      // 3a. v2: drop the tenant's Postgres schema + role from the shared cluster.
      await deprovisionProject(project.id);
    } else {
      // 3b. v1: remove dedicated Docker containers and volume.
      const pm = getProjectManager();
      await pm.nukeProject(slug, {
        acknowledgeDataLoss: true,
        hash: project.hash,
      });
    }

    // 4. Delete the catalog row (cascade-removes domains, heartbeat_log, etc.).
    await db.delete(projects).where(eq(projects.id, project.id));
    return Response.json({ ok: true });
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

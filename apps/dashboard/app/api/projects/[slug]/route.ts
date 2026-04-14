import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { auth } from "@/src/lib/auth";
import { projects } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getProjectManager } from "@/src/lib/flux";

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
 * Returns live status for a single project — used by the status-polling badge.
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
  const dockerList = await pm.listProjects().catch(() => []);
  const docker = dockerList.find((p) => p.slug === slug);

  let anonKey: string | null = null;
  let serviceRoleKey: string | null = null;
  let postgresConnectionString: string | null = null;

  try {
    const keys = await pm.getProjectKeys(slug);
    anonKey = keys.anonKey;
    serviceRoleKey = keys.serviceRoleKey;
  } catch {
    /* API container missing or env unreadable */
  }

  if (docker?.status === "running") {
    try {
      postgresConnectionString = await pm.getPostgresHostConnectionString(slug);
    } catch {
      /* Postgres unavailable */
    }
  }

  return Response.json({
    id: project.id,
    name: project.name,
    slug: project.slug,
    status: docker?.status ?? "stopped",
    apiUrl: docker?.apiUrl ?? `http://${slug}.flux.localhost`,
    anonKey,
    serviceRoleKey,
    postgresConnectionString,
    createdAt: project.createdAt,
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

  const pm = getProjectManager();
  try {
    if (action === "start") {
      await pm.startProject(slug);
    } else {
      await pm.stopProject(slug);
    }
    return Response.json({ ok: true, action });
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
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
    await pm.updatePostgrestJwtSecret(slug, jwtSecret);
    return Response.json({ ok: true });
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

/**
 * DELETE /api/projects/[slug]
 * Verifies ownership, removes Docker containers + volume, then deletes the DB record.
 * This is irreversible.
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

  const pm = getProjectManager();
  try {
    await pm.nukeProject(slug, { acknowledgeDataLoss: true });
    await db.delete(projects).where(eq(projects.id, project.id));
    return Response.json({ ok: true });
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

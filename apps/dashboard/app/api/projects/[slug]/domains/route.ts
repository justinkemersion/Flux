import { and, eq } from "drizzle-orm";
import { auth } from "@/src/lib/auth";
import { domains, projects } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";
import { evictHostname, normalizeHost } from "@flux/gateway";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

async function resolveOwnedProjectId(
  userId: string,
  slug: string,
): Promise<string | null> {
  await initSystemDb();
  const db = getDb();
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.slug, slug)))
    .limit(1);
  return project?.id ?? null;
}

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const { slug } = await ctx.params;
  const projectId = await resolveOwnedProjectId(session.user.id, slug);
  if (!projectId) return jsonError("Project not found", 404);

  const db = getDb();
  const rows = await db
    .select({ id: domains.id, hostname: domains.hostname, createdAt: domains.createdAt })
    .from(domains)
    .where(eq(domains.projectId, projectId));
  return Response.json({ domains: rows });
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const { slug } = await ctx.params;
  const projectId = await resolveOwnedProjectId(session.user.id, slug);
  if (!projectId) return jsonError("Project not found", 404);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const rawHostname = (body as { hostname?: unknown })?.hostname;
  if (typeof rawHostname !== "string" || rawHostname.trim().length === 0) {
    return jsonError('Expected JSON body with a non-empty "hostname" string field', 400);
  }

  const hostname = normalizeHost(rawHostname.trim());
  const db = getDb();
  const [created] = await db
    .insert(domains)
    .values({ hostname, projectId })
    .returning({ id: domains.id, hostname: domains.hostname, createdAt: domains.createdAt });
  await evictHostname(hostname);
  return Response.json({ domain: created }, { status: 201 });
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const { slug } = await ctx.params;
  const projectId = await resolveOwnedProjectId(session.user.id, slug);
  if (!projectId) return jsonError("Project not found", 404);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const rawHostname = (body as { hostname?: unknown })?.hostname;
  if (typeof rawHostname !== "string" || rawHostname.trim().length === 0) {
    return jsonError('Expected JSON body with a non-empty "hostname" string field', 400);
  }

  const hostname = normalizeHost(rawHostname.trim());
  const db = getDb();
  const removed = await db
    .delete(domains)
    .where(and(eq(domains.projectId, projectId), eq(domains.hostname, hostname)))
    .returning({ id: domains.id });
  if (removed.length === 0) return jsonError("Domain not found", 404);

  await evictHostname(hostname);
  return Response.json({ ok: true });
}

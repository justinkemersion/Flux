import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { auth } from "@/src/lib/auth";
import { projects } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";
import { listProjectAppliedMigrations } from "@/src/lib/project-applied-migrations";
import { runPooledMigrationsGet } from "@/src/lib/pooled-migrations-route";
import { listPooledAppliedMigrations } from "@/src/lib/pooled-migrations";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

async function loadProjectForPush(slug: string, hash: string) {
  const db = getDb();
  const [project] = await db
    .select({
      id: projects.id,
      mode: projects.mode,
      jwtSecret: projects.jwtSecret,
    })
    .from(projects)
    .where(and(eq(projects.slug, slug), eq(projects.hash, hash)))
    .limit(1);
  return project ?? null;
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * GET /api/projects/[slug]/migrations?hash=...
 *
 * Session auth: dashboard read-only applied ledger (v1 + v2).
 * Bearer JWT (service_role): legacy v2 push path — unchanged for `flux push`.
 */
export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const session = await auth();
  if (session?.user?.id) {
    const { slug } = await ctx.params;
    const hash = req.nextUrl.searchParams.get("hash")?.trim().toLowerCase() ?? "";
    if (!hash) return jsonError("Missing required query param: hash", 400);

    await initSystemDb();
    const db = getDb();
    const [project] = await db
      .select({
        id: projects.id,
        slug: projects.slug,
        hash: projects.hash,
        mode: projects.mode,
        apiSchemaName: projects.apiSchemaName,
        apiSchemaStrategy: projects.apiSchemaStrategy,
      })
      .from(projects)
      .where(
        and(
          eq(projects.slug, slug),
          eq(projects.hash, hash),
          eq(projects.userId, session.user.id),
        ),
      )
      .limit(1);

    if (!project) return jsonError("Project not found", 404);

    try {
      const applied = await listProjectAppliedMigrations(project);
      return Response.json(
        { applied },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not found|not running|No Postgres container/i.test(msg)) {
        return jsonError(msg, 400);
      }
      return jsonError(msg, 500);
    }
  }

  return runPooledMigrationsGet(req, ctx, {
    initSystemDb,
    loadProjectForPush,
    listAppliedMigrations: (tenantSchema) =>
      listPooledAppliedMigrations({ tenantSchema }),
  });
}

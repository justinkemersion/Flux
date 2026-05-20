import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { projects } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";
import { listPooledAppliedMigrations } from "@/src/lib/pooled-migrations";
import { runPooledMigrationsGet } from "@/src/lib/pooled-migrations-route";

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

/**
 * GET /api/projects/[slug]/migrations?hash=...
 * Lists applied SQL migrations from flux.flux_migrations (v2_shared).
 */
export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  return runPooledMigrationsGet(req, ctx, {
    initSystemDb,
    loadProjectForPush,
    listAppliedMigrations: listPooledAppliedMigrations,
  });
}

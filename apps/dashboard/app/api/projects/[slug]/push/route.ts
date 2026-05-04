import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { projects } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";
import { executePooledPush } from "@/src/lib/pooled-push";
import { runPooledPushPost } from "@/src/lib/pooled-push-route";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

async function loadProjectForPush(slug: string, hash: string) {
  const db = getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.slug, slug), eq(projects.hash, hash)))
    .limit(1);
  return project ?? null;
}

/**
 * POST /api/projects/[slug]/push
 *
 * Identity-aware SQL push for v2_shared (pooled) projects. Verifies a HS256
 * JWT signed with the project's `jwt_secret` (claim `role: "service_role"`),
 * then executes the SQL inside the tenant schema on the shared Postgres
 * cluster. Tunneled through the Dashboard so pooled tenants — which have no
 * dedicated container — can still receive `flux push` from the CLI.
 *
 * This endpoint is **CLI-only**: it does not back any UI surface. Per
 * docs/UI-SCOPE-CONTRACT.md the dashboard remains a control plane and does
 * not provide an in-browser SQL editor.
 *
 * Request body: `{ "hash": string, "sql": string }`
 * Auth header: `Authorization: Bearer <project-jwt>`
 */
export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  return runPooledPushPost(req, ctx, {
    initSystemDb,
    loadProjectForPush,
    executePooledPush,
  });
}

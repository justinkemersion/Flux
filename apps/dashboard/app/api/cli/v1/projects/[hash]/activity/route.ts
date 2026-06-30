import { and, eq } from "drizzle-orm";
import { FLUX_PROJECT_HASH_HEX_LEN } from "@flux/core";
import { projects } from "@/src/db/schema";
import { extractBearerToken } from "@/src/lib/cli-api-auth";
import { authorizeCliHttpRequest, cliRouteAuthJsonError } from "@/src/lib/mcp-route-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import { listProjectActivityEvents } from "@/src/lib/project-activity";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ hash: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function isValidHash(h: string): boolean {
  return h.length === FLUX_PROJECT_HASH_HEX_LEN && /^[a-f0-9]+$/u.test(h);
}

/**
 * GET /api/cli/v1/projects/[hash]/activity?limit=50
 *
 * CLI bearer auth: recent project timeline events (newest first).
 */
export async function GET(req: Request, context: Ctx): Promise<Response> {
  await initSystemDb();
  const db = getDb();
  const authResult = await authorizeCliHttpRequest(db, req);
  if (!authResult.ok) return cliRouteAuthJsonError(authResult);
  const auth = authResult.auth;

  const { hash: rawHash } = await context.params;
  const hash = rawHash.trim().toLowerCase();
  if (!isValidHash(hash)) {
    return jsonError(
      `hash must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-char lowercase hex id`,
      400,
    );
  }

  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 50;

  const [project] = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      hash: projects.hash,
    })
    .from(projects)
    .where(and(eq(projects.userId, auth.userId), eq(projects.hash, hash)))
    .limit(1);

  if (!project) return jsonError("Project not found for this API key", 404);

  const events = await listProjectActivityEvents(db, project.id, limit);
  return Response.json(
    {
      projectSlug: project.slug,
      hash: project.hash,
      events,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

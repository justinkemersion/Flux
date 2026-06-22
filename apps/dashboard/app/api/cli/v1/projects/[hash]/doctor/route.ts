import { and, eq } from "drizzle-orm";
import { FLUX_PROJECT_HASH_HEX_LEN } from "@flux/core";
import { projects } from "@/src/db/schema";
import { authenticateCliApiKey, extractBearerToken } from "@/src/lib/cli-api-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import { runProjectDoctor } from "@/src/lib/project-doctor";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ hash: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * POST /api/cli/v1/projects/:hash/doctor
 * Runs all project health checks and returns a DoctorReport.
 * Auth: CLI API key Bearer.
 */
export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  await initSystemDb();
  const db = getDb();
  const secret = extractBearerToken(_req.headers.get("authorization"));
  const auth = await authenticateCliApiKey(db, secret);
  if (!auth) return jsonError("Unauthorized", 401);

  const { hash: paramHash } = await ctx.params;
  const hash = (paramHash ?? "").trim().toLowerCase();
  if (
    hash.length !== FLUX_PROJECT_HASH_HEX_LEN ||
    !/^[a-f0-9]+$/u.test(hash)
  ) {
    return jsonError(
      `hash must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-char hex id`,
      400,
    );
  }

  const [project] = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      hash: projects.hash,
      mode: projects.mode,
      jwtSecret: projects.jwtSecret,
      apiSchemaName: projects.apiSchemaName,
      apiSchemaStrategy: projects.apiSchemaStrategy,
    })
    .from(projects)
    .where(and(eq(projects.userId, auth.userId), eq(projects.hash, hash)))
    .limit(1);

  if (!project) return jsonError("Project not found for this hash", 404);

  try {
    const report = await runProjectDoctor(project);
    return Response.json(report, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(msg, 500);
  }
}

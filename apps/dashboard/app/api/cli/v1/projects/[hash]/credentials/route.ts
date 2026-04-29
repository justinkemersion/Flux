import { and, eq } from "drizzle-orm";
import {
  FLUX_PROJECT_HASH_HEX_LEN,
} from "@flux/core";
import { projects } from "@/src/db/schema";
import {
  authenticateCliApiKey,
  extractBearerToken,
} from "@/src/lib/cli-api-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getProjectManager } from "@/src/lib/flux";

export const runtime = "nodejs";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function isValidHash(h: string): boolean {
  return (
    h.length === FLUX_PROJECT_HASH_HEX_LEN && /^[a-f0-9]+$/u.test(h)
  );
}

type Ctx = { params: Promise<{ hash: string }> };

const V2_NOTE =
  "Sign HS256 JWTs with projectJwtSecret; the gateway verifies them per Host. " +
  "Gateway→PostgREST uses the pool FLUX_GATEWAY_JWT_SECRET (not this value). There is no per-tenant Docker Postgres URI in pooled mode.";

/**
 * GET /api/cli/v1/projects/:hash/credentials
 * Bearer CLI API key. Same ownership rule as other CLI project routes.
 * v2_shared: returns `projectJwtSecret` for `FLUX_GATEWAY_JWT_SECRET` in app `.env`.
 */
export async function GET(req: Request, context: Ctx): Promise<Response> {
  await initSystemDb();
  const db = getDb();
  const secret = extractBearerToken(req.headers.get("authorization"));
  const auth = await authenticateCliApiKey(db, secret);
  if (!auth) {
    return jsonError("Unauthorized", 401);
  }

  const { hash: rawHash } = await context.params;
  const hash = (rawHash ?? "").trim().toLowerCase();
  if (!isValidHash(hash)) {
    return jsonError(
      `hash in path must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-char hex id`,
      400,
    );
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, auth.userId), eq(projects.hash, hash)))
    .limit(1);

  if (!project) {
    return jsonError("Project not found for this hash.", 404);
  }

  if (project.mode === "v2_shared") {
    if (!project.jwtSecret) {
      return jsonError(
        "Project jwt_secret is not set yet. Run Repair once in the dashboard or POST /api/projects/[slug]/repair.",
        503,
      );
    }
    return Response.json(
      {
        mode: "v2_shared" as const,
        slug: project.slug,
        hash: project.hash,
        projectJwtSecret: project.jwtSecret,
        note: V2_NOTE,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const pm = getProjectManager();
  try {
    const credentials = await pm.getProjectCredentials(
      project.slug,
      project.hash,
    );
    return Response.json(
      {
        mode: "v1_dedicated" as const,
        slug: project.slug,
        hash: project.hash,
        ...(project.jwtSecret
          ? { projectJwtSecret: project.jwtSecret }
          : {}),
        ...credentials,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(msg, 500);
  }
}

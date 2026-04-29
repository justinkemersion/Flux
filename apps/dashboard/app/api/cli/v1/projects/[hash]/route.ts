import { and, eq } from "drizzle-orm";
import {
  FLUX_PROJECT_HASH_HEX_LEN,
  slugifyProjectName,
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

/**
 * GET /api/cli/v1/projects/:hash
 * Bearer CLI key, ownership: catalog row for this (user, hash).
 * Returns mode metadata for CLI routing decisions.
 */
export async function GET(
  req: Request,
  context: Ctx,
): Promise<Response> {
  await initSystemDb();
  const db = getDb();
  const secret = extractBearerToken(req.headers.get("authorization"));
  const auth = await authenticateCliApiKey(db, secret);
  if (!auth) {
    return jsonError("Unauthorized", 401);
  }

  const { hash: paramHash } = await context.params;
  const hash = (paramHash ?? "").trim().toLowerCase();
  if (!isValidHash(hash)) {
    return jsonError(
      `hash in path must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-char hex id`,
      400,
    );
  }

  const [row] = await db
    .select({ slug: projects.slug, hash: projects.hash, mode: projects.mode })
    .from(projects)
    .where(and(eq(projects.userId, auth.userId), eq(projects.hash, hash)))
    .limit(1);
  if (!row) {
    return jsonError("Project not found for this hash.", 404);
  }

  return Response.json(
    {
      slug: row.slug,
      hash: row.hash,
      mode: row.mode,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * DELETE /api/cli/v1/projects/:hash
 * Bearer CLI key, ownership: catalog row for this (user, hash) when not forcing orphan cleanup.
 * Query: `?force=1&slug=...` — nuke Docker only if no catalog row (ghost / drift).
 * Sequence: `deleteProjectInfrastructure` → delete `projects` row (telemetry cascades) when a row
 * exists.
 */
export async function DELETE(
  req: Request,
  context: Ctx,
): Promise<Response> {
  await initSystemDb();
  const db = getDb();
  const secret = extractBearerToken(req.headers.get("authorization"));
  const auth = await authenticateCliApiKey(db, secret);
  if (!auth) {
    return jsonError("Unauthorized", 401);
  }

  const { hash: paramHash } = await context.params;
  const hash = (paramHash ?? "").trim().toLowerCase();
  if (!isValidHash(hash)) {
    return jsonError(
      `hash in path must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-char hex id`,
      400,
    );
  }

  const u = new URL(req.url);
  const force =
    u.searchParams.get("force") === "1" || u.searchParams.get("force") === "true";
  const forceSlugParam = (u.searchParams.get("slug") ?? "").trim();

  const [row] = await db
    .select()
    .from(projects)
    .where(
      and(eq(projects.userId, auth.userId), eq(projects.hash, hash)),
    )
    .limit(1);

  const pm = getProjectManager();

  if (row) {
    try {
      const result = await pm.deleteProjectInfrastructure(row.slug, row.hash);
      await db.delete(projects).where(eq(projects.id, row.id));
      return Response.json({
        ok: true,
        mode: "catalog" as const,
        hash: row.hash,
        removed: result.removed,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonError(msg, 500);
    }
  }

  if (force) {
    if (!forceSlugParam) {
      return jsonError(
        "No catalog row for this hash. Re-run with ?force=1&slug=<project-slug> (e.g. from flux.json) to remove orphaned containers and volume only.",
        400,
      );
    }
    let slug: string;
    try {
      slug = slugifyProjectName(forceSlugParam);
    } catch (e: unknown) {
      return jsonError(
        e instanceof Error ? e.message : "Invalid slug query parameter",
        400,
      );
    }
    try {
      const result = await pm.deleteProjectInfrastructure(slug, hash);
      return Response.json({
        ok: true,
        mode: "orphan" as const,
        hash,
        slug,
        removed: result.removed,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonError(msg, 500);
    }
  }

  return jsonError(
    "No project in your catalog for this hash. If Docker resources remain without a row, use ?force=1&slug=<name>.",
    404,
  );
}

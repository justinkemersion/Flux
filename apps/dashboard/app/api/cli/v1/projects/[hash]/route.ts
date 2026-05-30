import { and, eq } from "drizzle-orm";
import {
  FLUX_PROJECT_HASH_HEX_LEN,
  resolveTenantApiSchemaName,
} from "@flux/core";
import { projects } from "@/src/db/schema";
import {
  authenticateCliApiKey,
  extractBearerToken,
} from "@/src/lib/cli-api-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import { assertDestructiveBackupAllowed } from "@/src/lib/destructive-backup-gate";
import { runCliProjectDelete } from "@/src/lib/destructive-project-routes";
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
    .select({
      id: projects.id,
      slug: projects.slug,
      hash: projects.hash,
      mode: projects.mode,
      apiSchemaName: projects.apiSchemaName,
      apiSchemaStrategy: projects.apiSchemaStrategy,
    })
    .from(projects)
    .where(and(eq(projects.userId, auth.userId), eq(projects.hash, hash)))
    .limit(1);
  if (!row) {
    return jsonError("Project not found for this hash.", 404);
  }

  const apiSchema = resolveTenantApiSchemaName({
    id: row.id,
    mode: row.mode,
    apiSchemaName: row.apiSchemaName,
    apiSchemaStrategy: row.apiSchemaStrategy as "legacy_api" | "tenant_schema" | null,
  });

  return Response.json(
    {
      slug: row.slug,
      hash: row.hash,
      mode: row.mode,
      apiSchema,
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
  const pm = getProjectManager();
  return runCliProjectDelete(req, context, {
    initSystemDb,
    authenticateCli: async (authorizationHeader) => {
      const db = getDb();
      const secret = extractBearerToken(authorizationHeader);
      const auth = await authenticateCliApiKey(db, secret);
      return auth ? { userId: auth.userId } : null;
    },
    findOwnedProjectByHash: async (userId, hash) => {
      const db = getDb();
      const [row] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.userId, userId), eq(projects.hash, hash)))
        .limit(1);
      if (!row) return null;
      return {
        id: row.id,
        slug: row.slug,
        hash: row.hash,
        name: row.name,
        mode: row.mode,
      };
    },
    assertDestructiveBackupAllowed,
    deleteProjectInfrastructure: async (slug, hash) =>
      pm.deleteProjectInfrastructure(slug, hash),
    deleteCatalogRow: async (projectId) => {
      const db = getDb();
      await db.delete(projects).where(eq(projects.id, projectId));
    },
    deleteOrphanInfrastructure: async (slug, hash) =>
      pm.deleteProjectInfrastructure(slug, hash),
  });
}

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
import { getProjectManager } from "@/src/lib/flux";
import { listPooledAppliedMigrations } from "@/src/lib/pooled-migrations";

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
 * GET /api/cli/v1/projects/:hash/migrations
 * Lists applied SQL migrations from flux.flux_migrations.
 */
export async function GET(_req: Request, context: Ctx): Promise<Response> {
  await initSystemDb();
  const db = getDb();
  const secret = extractBearerToken(_req.headers.get("authorization"));
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
      mode: projects.mode,
      apiSchemaName: projects.apiSchemaName,
      apiSchemaStrategy: projects.apiSchemaStrategy,
    })
    .from(projects)
    .where(and(eq(projects.userId, auth.userId), eq(projects.hash, hash)))
    .limit(1);

  if (!row) {
    return jsonError("Project not found for this API key", 404);
  }

  const tenantSchema = resolveTenantApiSchemaName({
    id: row.id,
    mode: row.mode,
    apiSchemaName: row.apiSchemaName,
    apiSchemaStrategy: row.apiSchemaStrategy as
      | "legacy_api"
      | "tenant_schema"
      | null,
  });

  try {
    if (row.mode === "v2_shared") {
      const applied = await listPooledAppliedMigrations({ tenantSchema });
      return Response.json(
        { applied },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const pm = getProjectManager();
    const applied = await pm.listAppliedSqlMigrations(
      row.slug,
      hash,
      tenantSchema,
    );
    return Response.json(
      { applied },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      /not found|not running|No Postgres container/i.test(msg)
    ) {
      return jsonError(msg, 400);
    }
    return jsonError(msg, 500);
  }
}

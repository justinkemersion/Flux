import { and, eq } from "drizzle-orm";
import { FLUX_PROJECT_HASH_HEX_LEN, resolveTenantApiSchemaName } from "@flux/core";
import { projects } from "@/src/db/schema";
import { authenticateCliApiKey, extractBearerToken } from "@/src/lib/cli-api-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getProjectManager } from "@/src/lib/flux";
import type { MigrationPushMeta } from "@flux/core/sql-migrations";
import {
  parseMigrationPushMeta,
  pooledPushEffectiveSqlBytes,
} from "@/src/lib/pooled-push-validators";
import { executePooledPush } from "@/src/lib/pooled-push";
import { executePooledMigrationPush } from "@/src/lib/pooled-migrations";

export const runtime = "nodejs";

const MAX_SQL_BYTES = 4 * 1024 * 1024;

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function isValidHash(h: string): boolean {
  return (
    h.length === FLUX_PROJECT_HASH_HEX_LEN && /^[a-f0-9]+$/u.test(h)
  );
}

/**
 * Cross-version compatibility shim for SQL dumps produced by newer pg_dump
 * clients (e.g. PG17) and replayed against older targets (e.g. PG16).
 */
function normalizeSqlForTarget(sql: string): string {
  // PG16 and older do not recognize this GUC; harmless to drop from dumps.
  return sql.replace(/^\s*SET\s+transaction_timeout\s*=\s*[^;]+;\s*$/gimu, "");
}

/**
 * POST /api/cli/v1/push
 * Authorization: Bearer flx_live_…
 * Body: `{ "slug": string, "hash": string, "sql": string }`
 */
export async function POST(req: Request): Promise<Response> {
  await initSystemDb();
  const db = getDb();
  const secret = extractBearerToken(req.headers.get("authorization"));
  const auth = await authenticateCliApiKey(db, secret);
  if (!auth) {
    return jsonError("Unauthorized", 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("slug" in body) ||
    !("hash" in body) ||
    !("sql" in body) ||
    typeof (body as { slug: unknown }).slug !== "string" ||
    typeof (body as { hash: unknown }).hash !== "string" ||
    typeof (body as { sql: unknown }).sql !== "string"
  ) {
    return jsonError(
      'Expected JSON body with string "slug", "hash", and "sql" fields',
      400,
    );
  }

  const slug = (body as { slug: string }).slug.trim();
  const hash = (body as { hash: string }).hash.trim().toLowerCase();
  const sql = normalizeSqlForTarget((body as { sql: string }).sql);
  let migration: MigrationPushMeta | undefined;
  if ("migration" in body && (body as { migration: unknown }).migration != null) {
    const parsed = parseMigrationPushMeta(
      (body as { migration: unknown }).migration,
    );
    if (!parsed.ok) return jsonError(parsed.error, 400);
    migration = parsed.migration;
  }

  if (!slug) return jsonError("slug is required", 400);
  if (!isValidHash(hash)) {
    return jsonError(
      `hash must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-char lowercase hex id`,
      400,
    );
  }
  if (pooledPushEffectiveSqlBytes(sql, migration) > MAX_SQL_BYTES) {
    return jsonError("sql exceeds maximum size", 413);
  }

  const owned = await db
    .select({
      id: projects.id,
      mode: projects.mode,
      apiSchemaName: projects.apiSchemaName,
      apiSchemaStrategy: projects.apiSchemaStrategy,
    })
    .from(projects)
    .where(
      and(
        eq(projects.userId, auth.userId),
        eq(projects.slug, slug),
        eq(projects.hash, hash),
      ),
    )
    .limit(1);

  if (owned.length === 0) {
    return jsonError("Project not found for this API key", 404);
  }

  const row = owned[0]!;
  const apiSchema = resolveTenantApiSchemaName({
    id: row.id,
    mode: row.mode,
    apiSchemaName: row.apiSchemaName,
    apiSchemaStrategy: row.apiSchemaStrategy as "legacy_api" | "tenant_schema" | null,
  });

  const pm = getProjectManager();
  try {
    if (row.mode === "v2_shared") {
      if (migration) {
        const result = await executePooledMigrationPush({
          schema: apiSchema,
          userSql: sql,
          migration,
        });
        return Response.json(
          {
            ok: true,
            skipped: result.skipped,
            tablesMoved: 0,
            sequencesMoved: 0,
            viewsMoved: 0,
          } as const,
          { headers: { "Cache-Control": "private, no-store" } },
        );
      }
      await executePooledPush({ schema: apiSchema, sql });
      return Response.json(
        {
          ok: true,
          tablesMoved: 0,
          sequencesMoved: 0,
          viewsMoved: 0,
        } as const,
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const pushResult = await pm.pushSqlFromCli(slug, hash, sql, {
      searchPathSchemas: [apiSchema, "public"],
      ...(migration ? { migration } : {}),
    });
    if (migration) {
      return Response.json(
        {
          ok: true,
          skipped: pushResult.skipped,
          tablesMoved: 0,
          sequencesMoved: 0,
          viewsMoved: 0,
        } as const,
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      /not found|not running|HMAC password check failed/i.test(msg) ||
      msg.includes("No Postgres container")
    ) {
      return jsonError(msg, 400);
    }
    return jsonError(msg, 500);
  }

  return Response.json(
    {
      ok: true,
      tablesMoved: 0,
      sequencesMoved: 0,
      viewsMoved: 0,
    } as const,
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

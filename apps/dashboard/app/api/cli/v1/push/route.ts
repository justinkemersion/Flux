import { and, eq } from "drizzle-orm";
import { FLUX_PROJECT_HASH_HEX_LEN } from "@flux/core";
import { projects } from "@/src/db/schema";
import { authenticateCliApiKey, extractBearerToken } from "@/src/lib/cli-api-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getProjectManager } from "@/src/lib/flux";

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

  if (!slug) return jsonError("slug is required", 400);
  if (!isValidHash(hash)) {
    return jsonError(
      `hash must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-char lowercase hex id`,
      400,
    );
  }
  if (Buffer.byteLength(sql, "utf8") > MAX_SQL_BYTES) {
    return jsonError("sql exceeds maximum size", 413);
  }

  const owned = await db
    .select({ id: projects.id })
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

  const pm = getProjectManager();
  try {
    await pm.pushSqlFromCli(slug, hash, sql);
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

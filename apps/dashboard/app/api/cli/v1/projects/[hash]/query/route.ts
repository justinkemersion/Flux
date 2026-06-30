import { and, eq } from "drizzle-orm";
import {
  FLUX_PROJECT_HASH_HEX_LEN,
  resolveTenantApiSchemaName,
} from "@flux/core";
import { projects } from "@/src/db/schema";
import { extractBearerToken } from "@/src/lib/cli-api-auth";
import { authorizeCliHttpRequest, cliRouteAuthJsonError } from "@/src/lib/mcp-route-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getProjectManager } from "@/src/lib/flux";

export const runtime = "nodejs";

/** Dev-only ad-hoc SQL route. Production returns 404 when unset. */
function adhocQueryEnabled(): boolean {
  return process.env.FLUX_CLI_ALLOW_ADHOC_QUERY === "1";
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function isValidHash(h: string): boolean {
  return (
    h.length === FLUX_PROJECT_HASH_HEX_LEN && /^[a-f0-9]+$/u.test(h)
  );
}

/** Guard for dev-only ad-hoc query — SELECT/WITH only, no mutations. */
function assertReadOnlySelectSql(sql: string): void {
  const trimmed = sql.trim();
  if (!trimmed) {
    throw new Error("SQL must not be empty");
  }
  const lower = trimmed.toLowerCase();
  if (!lower.startsWith("select") && !lower.startsWith("with")) {
    throw new Error("Only SELECT or WITH queries are allowed");
  }
  const withoutTrailing = trimmed.replace(/;\s*$/, "");
  if (withoutTrailing.includes(";")) {
    throw new Error("Multiple SQL statements are not allowed");
  }
  if (
    /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|notify)\b/i.test(
      lower,
    )
  ) {
    throw new Error("Mutation keywords are not allowed in read-only query");
  }
  if (/\b(pg_authid|pg_shadow|pg_user)\b/i.test(lower)) {
    throw new Error("System credential catalogs are not allowed");
  }
}

type Ctx = { params: Promise<{ hash: string }> };

/**
 * POST /api/cli/v1/projects/:hash/query
 * Dev-only when FLUX_CLI_ALLOW_ADHOC_QUERY=1. Production default: 404.
 */
export async function POST(req: Request, context: Ctx): Promise<Response> {
  if (!adhocQueryEnabled()) {
    return new Response(null, { status: 404 });
  }

  await initSystemDb();
  const db = getDb();
  const authResult = await authorizeCliHttpRequest(db, req);
  if (!authResult.ok) {
    return cliRouteAuthJsonError(authResult);
  }
  const auth = authResult.auth;

  const { hash: paramHash } = await context.params;
  const hash = (paramHash ?? "").trim().toLowerCase();
  if (!isValidHash(hash)) {
    return jsonError(
      `hash in path must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-char hex id`,
      400,
    );
  }

  let body: { sql?: string };
  try {
    body = (await req.json()) as { sql?: string };
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const sql = body.sql?.trim();
  if (!sql) {
    return jsonError("sql is required", 400);
  }

  if (sql.length > 16_384) {
    return jsonError("sql exceeds maximum length", 400);
  }

  try {
    assertReadOnlySelectSql(sql);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(msg, 400);
  }

  const [row] = await db
    .select({
      slug: projects.slug,
      mode: projects.mode,
    })
    .from(projects)
    .where(and(eq(projects.userId, auth.userId), eq(projects.hash, hash)))
    .limit(1);

  if (!row) {
    return jsonError("Project not found for this hash", 404);
  }

  if (row.mode !== "v1_dedicated") {
    return jsonError(
      "Read-only schema query is v1_dedicated only (v2_shared not supported)",
      400,
    );
  }

  const pm = getProjectManager();
  try {
    const rows = await pm.queryTenantJsonRows(row.slug, hash, sql);
    return Response.json(
      { rows },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found|not running|No Postgres container/i.test(msg)) {
      return jsonError(msg, 400);
    }
    return jsonError(msg, 500);
  }
}

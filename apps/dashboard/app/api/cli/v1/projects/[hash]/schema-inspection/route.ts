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

export const runtime = "nodejs";

function jsonError(
  message: string,
  status: number,
  extra?: Record<string, unknown>,
): Response {
  return Response.json({ error: message, ...extra }, { status });
}

function isValidHash(h: string): boolean {
  return (
    h.length === FLUX_PROJECT_HASH_HEX_LEN && /^[a-f0-9]+$/u.test(h)
  );
}

type Ctx = { params: Promise<{ hash: string }> };

type SchemaInspectionAuditStatus = "success" | "error" | "unsupported";

function logSchemaInspectionAudit(input: {
  userId: string;
  hash: string;
  slug: string;
  durationMs: number;
  status: SchemaInspectionAuditStatus;
  tableCount?: number;
  warningCount?: number;
  error?: string;
}): void {
  console.info(
    JSON.stringify({
      event: "schema_inspection",
      userId: input.userId,
      hash: input.hash,
      slug: input.slug,
      durationMs: input.durationMs,
      status: input.status,
      ...(input.tableCount !== undefined
        ? { tableCount: input.tableCount }
        : {}),
      ...(input.warningCount !== undefined
        ? { warningCount: input.warningCount }
        : {}),
      ...(input.error ? { error: input.error.slice(0, 200) } : {}),
    }),
  );
}

/**
 * POST /api/cli/v1/projects/:hash/schema-inspection
 * Body (optional): { includeExactCounts?: boolean } — default false.
 * Server-owned fixed catalog queries only; no SQL input accepted.
 */
export async function POST(req: Request, context: Ctx): Promise<Response> {
  const started = Date.now();
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

  let includeExactCounts = false;
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      if (body.sql !== undefined || body.queries !== undefined) {
        return jsonError(
          "SQL-shaped input is not accepted; use fixed schema-inspection only",
          400,
        );
      }
      if (body.tableNames !== undefined) {
        return jsonError(
          "tableNames filter is not accepted on schema-inspection",
          400,
        );
      }
      includeExactCounts = body.includeExactCounts === true;
    } catch {
      return jsonError("Invalid JSON body", 400);
    }
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
    return jsonError("Project not found for this hash", 404);
  }

  if (row.mode !== "v1_dedicated") {
    logSchemaInspectionAudit({
      userId: auth.userId,
      hash,
      slug: row.slug,
      durationMs: Date.now() - started,
      status: "unsupported",
    });
    return jsonError(
      "Schema inspection is currently implemented for v1_dedicated only.",
      501,
      {
        error: "schema_inspection_unsupported",
        mode: row.mode,
      },
    );
  }

  const apiSchema = resolveTenantApiSchemaName({
    id: row.id,
    mode: row.mode,
    apiSchemaName: row.apiSchemaName,
    apiSchemaStrategy: row.apiSchemaStrategy as
      | "legacy_api"
      | "tenant_schema"
      | null,
  });

  const pm = getProjectManager();
  try {
    const result = await pm.inspectTenantSchema({
      slug: row.slug,
      hash,
      apiSchema,
      includeExactCounts,
    });
    logSchemaInspectionAudit({
      userId: auth.userId,
      hash,
      slug: row.slug,
      durationMs: Date.now() - started,
      status: "success",
      tableCount: result.summary.tableCount,
      warningCount: result.warnings.length,
    });
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logSchemaInspectionAudit({
      userId: auth.userId,
      hash,
      slug: row.slug,
      durationMs: Date.now() - started,
      status: "error",
      error: msg,
    });
    if (/not found|not running|No Postgres container/i.test(msg)) {
      return jsonError(msg, 400);
    }
    return jsonError(msg, 500);
  }
}

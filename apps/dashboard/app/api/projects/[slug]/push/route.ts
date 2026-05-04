import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { jwtVerify } from "jose";
import { FLUX_PROJECT_HASH_HEX_LEN } from "@flux/core";
import { projects } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";
import { executePooledPush } from "@/src/lib/pooled-push";
import {
  POOLED_PUSH_MAX_SQL_BYTES,
  extractPooledPushBearer,
  isValidFluxProjectHash,
  parsePooledPushJsonBody,
  tenantApiSchemaFromProjectId,
  validatePooledPushServiceRole,
  validatePooledPushSqlPayload,
} from "@/src/lib/pooled-push-validators";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

function jsonError(
  message: string,
  status: number,
  extra?: Record<string, unknown>,
): Response {
  return Response.json({ error: message, ...(extra ?? {}) }, { status });
}

/**
 * Narrow type guard for `pg.DatabaseError`-shaped errors without depending on
 * the class export (which `pg` exposes inconsistently across runtimes).
 */
function pgErrorFields(err: unknown): {
  message: string;
  code?: string;
  position?: string;
  hint?: string;
} | null {
  if (!err || typeof err !== "object") return null;
  const o = err as Record<string, unknown>;
  if (typeof o.message !== "string") return null;
  const out: { message: string; code?: string; position?: string; hint?: string } = {
    message: o.message,
  };
  if (typeof o.code === "string") out.code = o.code;
  if (typeof o.position === "string") out.position = o.position;
  if (typeof o.hint === "string") out.hint = o.hint;
  return out;
}

/**
 * POST /api/projects/[slug]/push
 *
 * Identity-aware SQL push for v2_shared (pooled) projects. Verifies a HS256
 * JWT signed with the project's `jwt_secret` (claim `role: "service_role"`),
 * then executes the SQL inside the tenant schema on the shared Postgres
 * cluster. Tunneled through the Dashboard so pooled tenants — which have no
 * dedicated container — can still receive `flux push` from the CLI.
 *
 * This endpoint is **CLI-only**: it does not back any UI surface. Per
 * docs/UI-SCOPE-CONTRACT.md the dashboard remains a control plane and does
 * not provide an in-browser SQL editor.
 *
 * Request body: `{ "hash": string, "sql": string }`
 * Auth header: `Authorization: Bearer <project-jwt>`
 */
export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { slug: rawSlug } = await ctx.params;
  const slug = rawSlug.trim();
  if (!slug) return jsonError("slug is required", 400);

  const token = extractPooledPushBearer(req.headers.get("authorization"));
  if (!token) return jsonError("Missing bearer token", 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const parsedBody = parsePooledPushJsonBody(body);
  if (!parsedBody.ok) {
    return jsonError(parsedBody.error, 400);
  }
  const { hash, sql } = parsedBody;

  if (!isValidFluxProjectHash(hash)) {
    return jsonError(
      `hash must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-char lowercase hex id`,
      400,
    );
  }
  const sqlCheck = validatePooledPushSqlPayload(sql, POOLED_PUSH_MAX_SQL_BYTES);
  if (!sqlCheck.ok) {
    return jsonError(sqlCheck.error, sqlCheck.status);
  }

  await initSystemDb();
  const db = getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.slug, slug), eq(projects.hash, hash)))
    .limit(1);

  if (!project) {
    return jsonError("Project not found", 404);
  }
  if (project.mode !== "v2_shared") {
    return jsonError(
      "Project is v1_dedicated; use the existing CLI flow (POST /api/cli/v1/push with API key).",
      400,
    );
  }
  if (!project.jwtSecret) {
    return jsonError(
      "Project jwt_secret is not set; run POST /api/projects/[slug]/repair once.",
      503,
    );
  }

  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(
      token,
      new TextEncoder().encode(project.jwtSecret),
      { algorithms: ["HS256"] },
    );
    payload = verified.payload as Record<string, unknown>;
  } catch {
    return jsonError("Invalid or expired token", 401);
  }

  const roleCheck = validatePooledPushServiceRole(payload);
  if (!roleCheck.ok) {
    return jsonError(roleCheck.error, 403);
  }

  const schemaRes = tenantApiSchemaFromProjectId(project.id);
  if (!schemaRes.ok) {
    return jsonError(schemaRes.error, 500);
  }
  const { schema } = schemaRes;

  try {
    await executePooledPush({ schema, sql });
  } catch (err: unknown) {
    const fields = pgErrorFields(err);
    if (fields) {
      const extra: Record<string, unknown> = {};
      if (fields.code) extra.sqlState = fields.code;
      if (fields.position) extra.position = fields.position;
      if (fields.hint) extra.hint = fields.hint;
      return jsonError(fields.message, 400, extra);
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/exceeded .* timeout/.test(msg)) {
      return jsonError(msg, 504);
    }
    return jsonError(msg, 500);
  }

  return Response.json(
    { ok: true, schema },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

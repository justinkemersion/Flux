import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { FLUX_PROJECT_HASH_HEX_LEN } from "@flux/core";
import type { ExecutePushInput } from "@/src/lib/pooled-push";
import {
  POOLED_PUSH_MAX_SQL_BYTES,
  extractPooledPushBearer,
  isValidFluxProjectHash,
  parsePooledPushJsonBody,
  tenantApiSchemaFromProjectId,
  validatePooledPushServiceRole,
  validatePooledPushSqlPayload,
} from "@/src/lib/pooled-push-validators";

export type PooledPushProjectRow = {
  id: string;
  mode: "v1_dedicated" | "v2_shared" | string;
  jwtSecret: string | null;
};

export type PooledPushRouteDeps = {
  initSystemDb: () => Promise<void>;
  loadProjectForPush: (
    slug: string,
    hash: string,
  ) => Promise<PooledPushProjectRow | null>;
  executePooledPush: (input: ExecutePushInput) => Promise<void>;
  /** Defaults to {@link POOLED_PUSH_MAX_SQL_BYTES}; tests may lower for SQL size cases. */
  maxSqlBytes?: number;
};

function jsonError(
  message: string,
  status: number,
  extra?: Record<string, unknown>,
): Response {
  return Response.json({ error: message, ...(extra ?? {}) }, { status });
}

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

type RouteCtx = { params: Promise<{ slug: string }> };

/**
 * POST /api/projects/[slug]/push — full handler with injectable persistence
 * (used by the route module and by route-level tests).
 */
export async function runPooledPushPost(
  req: NextRequest,
  ctx: RouteCtx,
  deps: PooledPushRouteDeps,
): Promise<Response> {
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
  const maxSql = deps.maxSqlBytes ?? POOLED_PUSH_MAX_SQL_BYTES;
  const sqlCheck = validatePooledPushSqlPayload(sql, maxSql);
  if (!sqlCheck.ok) {
    return jsonError(sqlCheck.error, sqlCheck.status);
  }

  await deps.initSystemDb();
  const project = await deps.loadProjectForPush(slug, hash);

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
    await deps.executePooledPush({ schema, sql });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/exceeded .* timeout/.test(msg)) {
      return jsonError(msg, 504);
    }
    const fields = pgErrorFields(err);
    if (fields?.code) {
      const extra: Record<string, unknown> = {};
      extra.sqlState = fields.code;
      if (fields.position) extra.position = fields.position;
      if (fields.hint) extra.hint = fields.hint;
      return jsonError(fields.message, 400, extra);
    }
    return jsonError(msg, 500);
  }

  return Response.json(
    { ok: true, schema },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

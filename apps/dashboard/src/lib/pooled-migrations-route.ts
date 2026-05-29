import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { FLUX_PROJECT_HASH_HEX_LEN } from "@flux/core";
import { tenantApiSchemaFromProjectId } from "@/src/lib/pooled-push-validators";
import type { FluxMigrationRecord } from "@flux/core/sql-migrations";
import {
  extractPooledPushBearer,
  isValidFluxProjectHash,
  validatePooledPushServiceRole,
} from "@/src/lib/pooled-push-validators";
import type { PooledPushProjectRow } from "@/src/lib/pooled-push-route";

export type PooledMigrationsRouteDeps = {
  initSystemDb: () => Promise<void>;
  loadProjectForPush: (
    slug: string,
    hash: string,
  ) => Promise<PooledPushProjectRow | null>;
  listAppliedMigrations: (tenantSchema: string) => Promise<FluxMigrationRecord[]>;
};

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

type RouteCtx = { params: Promise<{ slug: string }> };

/**
 * GET /api/projects/[slug]/migrations?hash=...
 */
export async function runPooledMigrationsGet(
  req: NextRequest,
  ctx: RouteCtx,
  deps: PooledMigrationsRouteDeps,
): Promise<Response> {
  const { slug: rawSlug } = await ctx.params;
  const slug = rawSlug.trim();
  if (!slug) return jsonError("slug is required", 400);

  const hashParam = req.nextUrl.searchParams.get("hash")?.trim().toLowerCase() ?? "";
  if (!hashParam) return jsonError("hash query parameter is required", 400);
  if (!isValidFluxProjectHash(hashParam)) {
    return jsonError(
      `hash must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-char lowercase hex id`,
      400,
    );
  }

  const token = extractPooledPushBearer(req.headers.get("authorization"));
  if (!token) return jsonError("Missing bearer token", 401);

  await deps.initSystemDb();
  const project = await deps.loadProjectForPush(slug, hashParam);
  if (!project) return jsonError("Project not found", 404);
  if (project.mode !== "v2_shared") {
    return jsonError(
      "Project is v1_dedicated; use GET /api/cli/v1/projects/[hash]/migrations with API key.",
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
  if (!roleCheck.ok) return jsonError(roleCheck.error, 403);

  const schemaRes = tenantApiSchemaFromProjectId(project.id);
  if (!schemaRes.ok) return jsonError(schemaRes.error, 500);

  try {
    const applied = await deps.listAppliedMigrations(schemaRes.schema);
    return Response.json(
      { applied },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(msg, 500);
  }
}

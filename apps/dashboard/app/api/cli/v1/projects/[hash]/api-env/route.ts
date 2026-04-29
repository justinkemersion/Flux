import { and, eq } from "drizzle-orm";
import { FLUX_PROJECT_HASH_HEX_LEN } from "@flux/core";
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

function parseEnvPatch(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || !("env" in raw)) {
    return null;
  }
  const env = (raw as { env: unknown }).env;
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    return null;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (!k.trim() || typeof v !== "string") {
      return null;
    }
    out[k.trim()] = v;
  }
  return out;
}

type Ctx = { params: Promise<{ hash: string }> };

async function resolveOwnedProjectByHash(hash: string, userId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      slug: projects.slug,
      hash: projects.hash,
    })
    .from(projects)
    .where(and(eq(projects.hash, hash), eq(projects.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * GET /api/cli/v1/projects/:hash/api-env
 * Returns PostgREST API container env entries for this owner/hash.
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

  const row = await resolveOwnedProjectByHash(hash, auth.userId);
  if (!row) {
    return jsonError("Project not found for this API key", 404);
  }

  const requestedSlug = new URL(req.url).searchParams.get("slug")?.trim();
  if (requestedSlug && requestedSlug !== row.slug) {
    return jsonError("Project slug/hash mismatch", 400);
  }

  const pm = getProjectManager();
  try {
    const env = await pm.listProjectEnv(row.slug, row.hash);
    return Response.json(env, { headers: { "Cache-Control": "private, no-store" } });
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
}

/**
 * PATCH /api/cli/v1/projects/:hash/api-env
 * Body: { "env": { "KEY": "value", ... } }
 */
export async function PATCH(
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const envPatch = parseEnvPatch(body);
  if (!envPatch) {
    return jsonError(
      'Expected JSON body: { "env": { "KEY": "value", ... } }',
      400,
    );
  }
  if (Object.keys(envPatch).length === 0) {
    return jsonError("env patch cannot be empty", 400);
  }

  const row = await resolveOwnedProjectByHash(hash, auth.userId);
  if (!row) {
    return jsonError("Project not found for this API key", 404);
  }

  const requestedSlug = new URL(req.url).searchParams.get("slug")?.trim();
  if (requestedSlug && requestedSlug !== row.slug) {
    return jsonError("Project slug/hash mismatch", 400);
  }

  const pm = getProjectManager();
  try {
    await pm.setProjectEnv(row.slug, envPatch, row.hash);
    return Response.json({ ok: true });
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
}

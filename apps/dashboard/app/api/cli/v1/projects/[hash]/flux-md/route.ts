import { and, eq } from "drizzle-orm";
import { FLUX_PROJECT_HASH_HEX_LEN } from "@flux/core";
import { FluxMdValidationError } from "@flux/core/flux-md";
import { projects } from "@/src/db/schema";
import { authenticateCliApiKey, extractBearerToken } from "@/src/lib/cli-api-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import {
  getProjectFluxMdById,
  syncOwnedProjectFluxMd,
} from "@/src/lib/project-flux-md";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ hash: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function isValidHash(h: string): boolean {
  return h.length === FLUX_PROJECT_HASH_HEX_LEN && /^[a-f0-9]+$/u.test(h);
}

async function loadOwnedByHash(db: ReturnType<typeof getDb>, userId: string, hash: string) {
  const [row] = await db
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.hash, hash)))
    .limit(1);
  return row ?? null;
}

/**
 * GET /api/cli/v1/projects/[hash]/flux-md
 */
export async function GET(req: Request, context: Ctx): Promise<Response> {
  await initSystemDb();
  const db = getDb();
  const secret = extractBearerToken(req.headers.get("authorization"));
  const auth = await authenticateCliApiKey(db, secret);
  if (!auth) return jsonError("Unauthorized", 401);

  const { hash: rawHash } = await context.params;
  const hash = rawHash.trim().toLowerCase();
  if (!isValidHash(hash)) {
    return jsonError(
      `hash must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-char lowercase hex id`,
      400,
    );
  }

  const owned = await loadOwnedByHash(db, auth.userId, hash);
  if (!owned) return jsonError("Project not found for this API key", 404);

  const fluxMd = await getProjectFluxMdById(db, owned.id);
  if (!fluxMd) return jsonError("Project not found", 404);

  return Response.json(
    { fluxMd },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * PUT /api/cli/v1/projects/[hash]/flux-md
 * Body: `{ content: string | null }`
 */
export async function PUT(req: Request, context: Ctx): Promise<Response> {
  await initSystemDb();
  const db = getDb();
  const secret = extractBearerToken(req.headers.get("authorization"));
  const auth = await authenticateCliApiKey(db, secret);
  if (!auth) return jsonError("Unauthorized", 401);

  const { hash: rawHash } = await context.params;
  const hash = rawHash.trim().toLowerCase();
  if (!isValidHash(hash)) {
    return jsonError(
      `hash must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-char lowercase hex id`,
      400,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  if (!body || typeof body !== "object") {
    return jsonError("Expected JSON object body", 400);
  }
  const record = body as Record<string, unknown>;
  if (!("content" in record)) {
    return jsonError('Provide "content" (string or null)', 400);
  }
  if (record.content !== null && typeof record.content !== "string") {
    return jsonError("content must be a string or null", 400);
  }

  const owned = await loadOwnedByHash(db, auth.userId, hash);
  if (!owned) return jsonError("Project not found for this API key", 404);

  try {
    const fluxMd = await syncOwnedProjectFluxMd(
      db,
      { slug: owned.slug, hash, userId: auth.userId },
      record.content as string | null,
    );
    return Response.json({ fluxMd });
  } catch (err: unknown) {
    if (err instanceof FluxMdValidationError) {
      return jsonError(err.message, 400);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(msg, 500);
  }
}

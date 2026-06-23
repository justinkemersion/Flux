import { and, eq } from "drizzle-orm";
import { FLUX_PROJECT_HASH_HEX_LEN } from "@flux/core";
import { ProjectMetadataValidationError } from "@flux/core/project-metadata";
import { projects } from "@/src/db/schema";
import { authenticateCliApiKey, extractBearerToken } from "@/src/lib/cli-api-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import {
  getProjectMetadataById,
  patchOwnedProjectMetadata,
} from "@/src/lib/project-metadata";

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
 * GET /api/cli/v1/projects/[hash]/metadata
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

  const meta = await getProjectMetadataById(db, owned.id);
  if (!meta) return jsonError("Project not found", 404);

  return Response.json(
    { metadata: meta },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * PATCH /api/cli/v1/projects/[hash]/metadata
 */
export async function PATCH(req: Request, context: Ctx): Promise<Response> {
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
  const patch = body as Record<string, unknown>;
  if (!("description" in patch) && !("brief" in patch)) {
    return jsonError('Provide at least one of "description" or "brief"', 400);
  }
  if (
    "description" in patch &&
    patch.description !== null &&
    typeof patch.description !== "string"
  ) {
    return jsonError("description must be a string or null", 400);
  }
  if (
    "brief" in patch &&
    patch.brief !== null &&
    typeof patch.brief !== "string"
  ) {
    return jsonError("brief must be a string or null", 400);
  }

  const owned = await loadOwnedByHash(db, auth.userId, hash);
  if (!owned) return jsonError("Project not found for this API key", 404);

  try {
    const meta = await patchOwnedProjectMetadata(
      db,
      { slug: owned.slug, hash, userId: auth.userId },
      {
        ...( "description" in patch
          ? { description: patch.description as string | null }
          : {}),
        ...( "brief" in patch ? { brief: patch.brief as string | null } : {}),
      },
    );
    return Response.json({ metadata: meta });
  } catch (err: unknown) {
    if (err instanceof ProjectMetadataValidationError) {
      return jsonError(err.message, 400);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(msg, 500);
  }
}

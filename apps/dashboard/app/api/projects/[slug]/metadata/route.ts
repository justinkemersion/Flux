import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { ProjectMetadataValidationError } from "@flux/core/project-metadata";
import { auth } from "@/src/lib/auth";
import { projects } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";
import {
  loadOwnedProjectMetadata,
  patchOwnedProjectMetadata,
} from "@/src/lib/project-metadata";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function parseHash(req: NextRequest): string | null {
  const hash = req.nextUrl.searchParams.get("hash")?.trim().toLowerCase() ?? "";
  if (!/^[a-f0-9]{7}$/u.test(hash)) return null;
  return hash;
}

/**
 * GET /api/projects/[slug]/metadata?hash=<7hex>
 */
export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const hash = parseHash(req);
  if (!hash) return jsonError("Missing or invalid hash query param", 400);

  const { slug } = await ctx.params;
  await initSystemDb();
  const db = getDb();
  const meta = await loadOwnedProjectMetadata(db, {
    slug,
    hash,
    userId: session.user.id,
  });
  if (!meta) return jsonError("Project not found", 404);

  return Response.json(
    { metadata: meta },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * PATCH /api/projects/[slug]/metadata?hash=<7hex>
 * Body: `{ description?: string | null, brief?: string | null }`
 */
export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const hash = parseHash(req);
  if (!hash) return jsonError("Missing or invalid hash query param", 400);

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

  const { slug } = await ctx.params;
  await initSystemDb();
  const db = getDb();

  try {
    const meta = await patchOwnedProjectMetadata(
      db,
      { slug, hash, userId: session.user.id },
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
    if (msg === "Project not found") return jsonError(msg, 404);
    return jsonError(msg, 500);
  }
}

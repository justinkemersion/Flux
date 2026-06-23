import type { NextRequest } from "next/server";
import { FluxMdValidationError } from "@flux/core/flux-md";
import { auth } from "@/src/lib/auth";
import { loadOwnedProjectFluxMd, syncOwnedProjectFluxMd } from "@/src/lib/project-flux-md";
import { getDb, initSystemDb } from "@/src/lib/db";

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
 * GET /api/projects/[slug]/flux-md?hash=<7hex>
 */
export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const hash = parseHash(req);
  if (!hash) return jsonError("Missing or invalid hash query param", 400);

  const { slug } = await ctx.params;
  await initSystemDb();
  const db = getDb();
  const brief = await loadOwnedProjectFluxMd(db, {
    slug,
    hash,
    userId: session.user.id,
  });
  if (!brief) return jsonError("Project not found", 404);

  return Response.json(
    { fluxMd: brief },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * PUT /api/projects/[slug]/flux-md?hash=<7hex>
 * Body: `{ content: string | null }` — null clears the dashboard snapshot.
 */
export async function PUT(req: NextRequest, ctx: Ctx): Promise<Response> {
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
  const record = body as Record<string, unknown>;
  if (!("content" in record)) {
    return jsonError('Provide "content" (string or null)', 400);
  }
  if (record.content !== null && typeof record.content !== "string") {
    return jsonError("content must be a string or null", 400);
  }

  const { slug } = await ctx.params;
  await initSystemDb();
  const db = getDb();

  try {
    const fluxMd = await syncOwnedProjectFluxMd(
      db,
      { slug, hash, userId: session.user.id },
      record.content as string | null,
    );
    return Response.json({ fluxMd });
  } catch (err: unknown) {
    if (err instanceof FluxMdValidationError) {
      return jsonError(err.message, 400);
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "Project not found") return jsonError(msg, 404);
    return jsonError(msg, 500);
  }
}

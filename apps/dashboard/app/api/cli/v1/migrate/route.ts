import { authenticateCliApiKey, extractBearerToken } from "@/src/lib/cli-api-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getProjectManager } from "@/src/lib/flux";
import { runV2SharedToV1DedicatedMigration } from "@/src/lib/v2-to-v1-migrate";
import type { MigrateCliPayload } from "@flux/migrate";

export const runtime = "nodejs";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * POST /api/cli/v1/migrate
 * Bearer CLI key. Body: {@link MigrateCliPayload}
 */
export async function POST(req: Request): Promise<Response> {
  await initSystemDb();
  const db = getDb();
  const secret = extractBearerToken(req.headers.get("authorization"));
  const auth = await authenticateCliApiKey(db, secret);
  if (!auth) {
    return jsonError("Unauthorized", 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("slug" in body) ||
    !("hash" in body) ||
    typeof (body as { slug: unknown }).slug !== "string" ||
    typeof (body as { hash: unknown }).hash !== "string"
  ) {
    return jsonError('Expected JSON body with string "slug" and "hash" fields', 400);
  }

  const payload = body as MigrateCliPayload;
  const pm = getProjectManager();
  let result: Awaited<ReturnType<typeof runV2SharedToV1DedicatedMigration>>;
  try {
    result = await runV2SharedToV1DedicatedMigration({
      db,
      pm,
      userId: auth.userId,
      payload,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonError(`Migration failed: ${message}`, 500);
  }

  if (!result.ok) {
    return Response.json(result, {
      status: 400,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  return Response.json(result, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

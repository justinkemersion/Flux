import { eq } from "drizzle-orm";
import { projects } from "@/src/db/schema";
import { authenticateCliApiKey, extractBearerToken } from "@/src/lib/cli-api-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getProjectManager } from "@/src/lib/flux";

export const runtime = "nodejs";

/**
 * GET /api/cli/v1/list
 * Authorization: Bearer flx_live_<32hex>_<4hex_checksum>
 * Response: JSON array of {@link FluxProjectSummary} (see `@flux/core/standalone`).
 */
export async function GET(req: Request): Promise<Response> {
  await initSystemDb();
  const db = getDb();
  const secret = extractBearerToken(req.headers.get("authorization"));
  const auth = await authenticateCliApiKey(db, secret);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pm = getProjectManager();
  try {
    const summaries = await pm.getProjectSummariesForUser(auth.userId, {
      loadSlugRefsForUser: async (userId) =>
        db
          .select({ slug: projects.slug, hash: projects.hash })
          .from(projects)
          .where(eq(projects.userId, userId)),
      isProduction: process.env.NODE_ENV === "production",
    });
    return Response.json(summaries, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `Docker status unavailable: ${msg}` },
      { status: 503 },
    );
  }
}

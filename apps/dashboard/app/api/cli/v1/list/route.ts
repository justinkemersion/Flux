import { fluxApiUrlForCatalog, slugifyProjectName } from "@flux/core";
import { normalizeProjectLifecycleState } from "@flux/core/project-lifecycle-state";
import type { FluxProjectSummary } from "@flux/core/standalone";
import { eq } from "drizzle-orm";
import { projects } from "@/src/db/schema";
import { extractBearerToken } from "@/src/lib/cli-api-auth";
import { isMcpControlPlaneAuth } from "@/src/lib/control-plane-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import { authorizeCliRoute, cliRouteAuthJsonError } from "@/src/lib/mcp-route-auth";
import { getProjectManager } from "@/src/lib/flux";
import { statusFromV2CatalogHealth } from "@/src/lib/v2-project-status";

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
  const authResult = await authorizeCliRoute(db, secret, {
    pathname: new URL(req.url).pathname,
    method: "GET",
  });
  if (!authResult.ok) {
    return cliRouteAuthJsonError(authResult);
  }
  const auth = authResult.auth;

  const pm = getProjectManager();
  try {
    const rows = await db
      .select({
        id: projects.id,
        slug: projects.slug,
        hash: projects.hash,
        mode: projects.mode,
        healthStatus: projects.healthStatus,
        lifecycleState: projects.lifecycleState,
      })
      .from(projects)
      .where(eq(projects.userId, auth.userId));

    const scopedRows = isMcpControlPlaneAuth(auth)
      ? rows.filter((row) => auth.projectIds.includes(row.id))
      : rows;

    const isProduction = process.env.NODE_ENV === "production";
    const v1Refs = scopedRows
      .filter((r) => r.mode === "v1_dedicated")
      .map((r) => ({ slug: r.slug, hash: r.hash }));

    let v1Summaries: FluxProjectSummary[] = [];
    if (v1Refs.length > 0) {
      v1Summaries = await pm.getProjectSummariesForSlugs(
        v1Refs,
        isProduction ? { isProduction: true } : {},
      );
    }

    const v1BySlugHash = new Map(
      v1Summaries.map((s) => [`${s.slug}\0${s.hash}`, s] as const),
    );

    const summaries: FluxProjectSummary[] = scopedRows.map((r, i) => {
      const slug = slugifyProjectName(r.slug);
      const lifecycleState = normalizeProjectLifecycleState(r.lifecycleState);
      let base: FluxProjectSummary;
      if (r.mode === "v2_shared") {
        base = {
          slug,
          hash: r.hash,
          status: statusFromV2CatalogHealth({
            healthStatus: r.healthStatus ?? null,
          }),
          apiUrl: fluxApiUrlForCatalog(slug, r.hash, isProduction, "v2_shared"),
        };
      } else {
        base =
          v1BySlugHash.get(`${slug}\0${r.hash}`) ?? {
            slug,
            hash: r.hash,
            status: "missing",
            apiUrl: fluxApiUrlForCatalog(slug, r.hash, isProduction, "v1_dedicated"),
          };
      }
      return { ...base, lifecycleState };
    });

    summaries.sort((a, b) => a.slug.localeCompare(b.slug));

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

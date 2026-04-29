import { and, eq, isNull, or } from "drizzle-orm";
import { auth } from "@/src/lib/auth";
import { projects } from "@/src/db/schema";
import { projectHealthBucket } from "@/src/lib/fleet-overview";
import { statusFromV2CatalogHealth } from "@/src/lib/v2-project-status";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getProjectManager } from "@/src/lib/flux";

export const runtime = "nodejs";

/**
 * GET /api/fleet/overview
 * Node telemetry (Docker + `os`) plus per-project health buckets for the Control Room grid.
 */
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  await initSystemDb();
  const db = getDb();
  const pm = getProjectManager();

  const userProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, session.user.id));

  // v2_shared projects have no dedicated Docker pair; querying them via Docker summaries
  // misclassifies healthy shared-mode tenants as "missing".
  const v1Projects = userProjects.filter((p) => p.mode !== "v2_shared");
  let summaryBySlug = new Map<string, Awaited<ReturnType<typeof pm.getProjectSummariesForUser>>[number]>();
  if (v1Projects.length > 0) {
    const v1Slugs = new Set(v1Projects.map((p) => p.slug));
    let summaries: Awaited<ReturnType<typeof pm.getProjectSummariesForUser>>;
    try {
      summaries = await pm.getProjectSummariesForUser(session.user.id, {
        loadSlugRefsForUser: async (userId) =>
          db
            .select({ slug: projects.slug, hash: projects.hash })
            .from(projects)
            .where(
              and(
                eq(projects.userId, userId),
                or(eq(projects.mode, "v1_dedicated"), isNull(projects.mode)),
              ),
            ),
        isProduction: process.env.NODE_ENV === "production",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return Response.json(
        { error: `Docker project status unavailable: ${msg}` },
        { status: 503 },
      );
    }
    summaryBySlug = new Map(
      summaries.filter((s) => v1Slugs.has(s.slug)).map((s) => [s.slug, s]),
    );
  }

  let node: Awaited<ReturnType<typeof pm.getNodeStats>>;
  try {
    node = await pm.getNodeStats();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      { error: `Node stats unavailable: ${msg}` },
      { status: 503 },
    );
  }

  const projectCells = userProjects.map((p) => {
    const status =
      p.mode === "v2_shared"
        ? statusFromV2CatalogHealth({ healthStatus: p.healthStatus ?? null })
        : (summaryBySlug.get(p.slug)?.status ?? "missing");
    const health = projectHealthBucket({
      status,
      healthStatus: p.healthStatus ?? null,
    });
    return { slug: p.slug, name: p.name, health };
  });

  const summary = { running: 0, degraded: 0, error: 0 } as {
    running: number;
    degraded: number;
    error: number;
  };
  for (const c of projectCells) {
    summary[c.health] += 1;
  }

  return Response.json(
    { node, summary, projects: projectCells },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

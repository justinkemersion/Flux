import { eq } from "drizzle-orm";
import { auth } from "@/src/lib/auth";
import { projects } from "@/src/db/schema";
import { projectHealthBucket } from "@/src/lib/fleet-overview";
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

  let summaries: Awaited<ReturnType<typeof pm.getProjectSummariesForUser>>;
  try {
    summaries = await pm.getProjectSummariesForUser(session.user.id, {
      loadSlugRefsForUser: async (userId) =>
        db
          .select({ slug: projects.slug, hash: projects.hash })
          .from(projects)
          .where(eq(projects.userId, userId)),
      isProduction: process.env.NODE_ENV === "production",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      { error: `Docker project status unavailable: ${msg}` },
      { status: 503 },
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

  const summaryBySlug = new Map(summaries.map((s) => [s.slug, s]));
  const projectCells = userProjects.map((p) => {
    const s = summaryBySlug.get(p.slug);
    const status = s?.status ?? "missing";
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

import { inArray } from "drizzle-orm";
import { projects } from "@/src/db/schema";
import { LANDING_FLEET_SLUGS } from "@/src/lib/fleet-showcase";
import { deriveTelemetryDisplay, fleetTelemetryLabel } from "@/src/lib/fleet-telemetry-display";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getFleetReliability } from "@/src/lib/fleet-monitor";
import { getProjectManager } from "@/src/lib/flux";

export const runtime = "nodejs";

/**
 * Public, allow-listed mesh telemetry for the marketing fleet (no auth).
 */
export async function GET() {
  await initSystemDb();
  const reliability = await getFleetReliability();
  const db = getDb();
  const slugs = [...LANDING_FLEET_SLUGS];
  const rows = await db
    .select({
      slug: projects.slug,
      hash: projects.hash,
      lastHeartbeatAt: projects.lastHeartbeatAt,
      healthStatus: projects.healthStatus,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .where(inArray(projects.slug, slugs));
  const bySlug = new Map(rows.map((r) => [r.slug, r]));

  const refList = slugs
    .map((slug) => {
      const row = bySlug.get(slug);
      return row ? { slug: row.slug, hash: row.hash } : null;
    })
    .filter((r): r is { slug: string; hash: string } => r !== null);
  const pm = getProjectManager();
  const summaries = await pm.getProjectSummariesForSlugs(
    refList,
    { isProduction: process.env.NODE_ENV === "production" },
  );
  const bySlugStatus = new Map(
    summaries.map((sum) => [sum.slug, sum] as const),
  );

  const items = slugs.map((slug) => {
    const row = bySlug.get(slug);
    const sum = bySlugStatus.get(slug);
    const level = deriveTelemetryDisplay({
      healthStatus: row?.healthStatus,
      lastHeartbeatAt: row?.lastHeartbeatAt,
      createdAt: row?.createdAt,
      stackStatus: sum?.status,
    });
    return {
      slug,
      level,
      label: fleetTelemetryLabel(level),
      lastHeartbeatAt: row?.lastHeartbeatAt
        ? row.lastHeartbeatAt.toISOString()
        : null,
      healthStatus: row?.healthStatus ?? null,
    };
  });

  return Response.json(
    {
      items,
      generatedAt: new Date().toISOString(),
      reliability: {
        windowHours: reliability.windowHours,
        percent: reliability.percent,
        successCount: reliability.successCount,
        totalCount: reliability.totalCount,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

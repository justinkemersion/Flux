import { inArray } from "drizzle-orm";
import { projects } from "@/src/db/schema";
import { LANDING_FLEET_SLUGS } from "@/src/lib/fleet-showcase";
import { deriveTelemetryDisplay, fleetTelemetryLabel } from "@/src/lib/fleet-telemetry-display";
import { getDb, initSystemDb } from "@/src/lib/db";

export const runtime = "nodejs";

/**
 * Public, allow-listed mesh telemetry for the marketing fleet (no auth).
 */
export async function GET() {
  await initSystemDb();
  const db = getDb();
  const slugs = [...LANDING_FLEET_SLUGS];
  const rows = await db
    .select({
      slug: projects.slug,
      lastHeartbeatAt: projects.lastHeartbeatAt,
      healthStatus: projects.healthStatus,
    })
    .from(projects)
    .where(inArray(projects.slug, slugs));
  const bySlug = new Map(rows.map((r) => [r.slug, r]));

  const items = slugs.map((slug) => {
    const row = bySlug.get(slug);
    const level = deriveTelemetryDisplay(
      row?.healthStatus,
      row?.lastHeartbeatAt,
    );
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
    { items, generatedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

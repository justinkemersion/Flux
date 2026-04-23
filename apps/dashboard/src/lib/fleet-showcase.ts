import { inArray } from "drizzle-orm";
import { projects } from "@/src/db/schema";
import {
  type FleetTelemetryLevel,
  deriveTelemetryDisplay,
} from "@/src/lib/fleet-telemetry-display";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getProjectManager } from "@/src/lib/flux";

export const LANDING_FLEET_SLUGS = ["yeastcoast"] as const;

export type FleetShowcaseCard = {
  name: string;
  host: string;
  href: string;
  description: string;
  slug: string;
  level: FleetTelemetryLevel;
};

const STATIC: Omit<FleetShowcaseCard, "level">[] = [
  {
    name: "YeastCoast",
    host: "yeastcoast.vsl-base.com",
    href: "https://yeastcoast.vsl-base.com",
    description:
      "Flux infrastructure: dedicated PostgREST + Postgres for a production app — share beer recipes, fork brews, track ingredients, fermentation, and simulation.",
    slug: "yeastcoast",
  },
];

/**
 * Public landing fleet rows with live mesh level from flux-system.
 */
export async function getLandingFleetShowcase(): Promise<FleetShowcaseCard[]> {
  await initSystemDb();
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

  const pm = getProjectManager();
  const refList = slugs
    .map((slug) => {
      const row = bySlug.get(slug);
      return row
        ? { slug: row.slug, hash: row.hash }
        : null;
    })
    .filter((r): r is { slug: string; hash: string } => r !== null);
  const summaries = await pm.getProjectSummariesForSlugs(
    refList,
    { isProduction: process.env.NODE_ENV === "production" },
  );
  const bySlugStatus = new Map(
    summaries.map((sum) => [sum.slug, sum] as const),
  );

  return STATIC.map((s) => {
    const row = bySlug.get(s.slug);
    const sum = bySlugStatus.get(s.slug);
    const level = deriveTelemetryDisplay({
      healthStatus: row?.healthStatus,
      lastHeartbeatAt: row?.lastHeartbeatAt,
      createdAt: row?.createdAt,
      stackStatus: sum?.status,
    });
    return { ...s, level };
  });
}

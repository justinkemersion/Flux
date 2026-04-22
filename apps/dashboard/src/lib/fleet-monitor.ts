import { eq } from "drizzle-orm";
import { fluxApiUrlForSlug } from "@flux/core";
import { projects } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";

const INTERVAL_MS = 2 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

let started = false;

function isProbeSuccess(status: number): boolean {
  return status >= 200 && status < 400;
}

async function probeApiUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return isProbeSuccess(res.status);
  } catch {
    return false;
  }
}

/**
 * Fetches all catalog projects, probes their PostgREST base URL, and records
 * `health_status` + `last_heartbeat_at` in flux-system.
 */
export async function runFleetMonitorTick(): Promise<void> {
  await initSystemDb();
  const db = getDb();
  const rows = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      hash: projects.hash,
    })
    .from(projects);
  if (rows.length === 0) {
    return;
  }

  const isProd = process.env.NODE_ENV === "production";
  const now = new Date();
  await Promise.all(
    rows.map(async (row) => {
      const apiUrl = fluxApiUrlForSlug(row.slug, row.hash, isProd);
      const ok = await probeApiUrl(apiUrl);
      await db
        .update(projects)
        .set({
          healthStatus: ok ? "running" : "error",
          lastHeartbeatAt: now,
        })
        .where(eq(projects.id, row.id));
    }),
  );
}

/**
 * Idempotent: starts at most one 2-minute interval in this Node process.
 */
export function startFleetMonitor(): void {
  if (started) {
    return;
  }
  started = true;

  void (async () => {
    try {
      await runFleetMonitorTick();
    } catch (err) {
      console.error("[flux] fleet-monitor initial tick failed:", err);
    }
  })();

  setInterval(() => {
    void runFleetMonitorTick().catch((err) => {
      console.error("[flux] fleet-monitor tick failed:", err);
    });
  }, INTERVAL_MS);
}

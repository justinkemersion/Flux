import { and, count, eq, sql } from "drizzle-orm";
import { fluxApiUrlForSlug } from "@flux/core";
import { projectHeartbeatLog, projects } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";

const INTERVAL_MS = 2 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;
/** ~1 in 20 ticks (≈40 min at 2m interval) — limit write lock / churn on `project_heartbeat_log`. */
const PRUNE_PROBABILITY = 0.05;

const ANSI_DIM = "\x1b[2m";
const ANSI_GRAY = "\x1b[90m";
const ANSI_RESET = "\x1b[0m";

let started = false;

export type FleetReliability = {
  /** 0–100, or null when there are no samples in the window. */
  percent: number | null;
  successCount: number;
  totalCount: number;
  windowHours: 24;
};

/**
 * Share of successful mesh probes in the last 24h (`project_heartbeat_log`, `health_status = 'running'`
 * over all rows in the window). Used for the public landing reliability strip and fleet API.
 */
export async function getFleetReliability(): Promise<FleetReliability> {
  await initSystemDb();
  const db = getDb();
  const inWindow = sql`${projectHeartbeatLog.recordedAt} >= (now() - interval '24 hours')`;
  const [t] = await db
    .select({ c: count() })
    .from(projectHeartbeatLog)
    .where(inWindow);
  const [s] = await db
    .select({ c: count() })
    .from(projectHeartbeatLog)
    .where(
      and(inWindow, eq(projectHeartbeatLog.healthStatus, "running")),
    );
  const totalCount = Number(t?.c ?? 0);
  const successCount = Number(s?.c ?? 0);
  const percent =
    totalCount === 0 ? null : (successCount / totalCount) * 100;
  return {
    percent,
    successCount,
    totalCount,
    windowHours: 24,
  };
}

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
 * `DELETE` telemetry samples where `recorded_at` is before `now() - 24 hours` (DB clock).
 * Invoked from the end of a fleet tick, occasionally, so the log does not grow without bound.
 */
export async function pruneTelemetry(): Promise<void> {
  await initSystemDb();
  const db = getDb();
  const deleted = await db
    .delete(projectHeartbeatLog)
    .where(
      sql`${projectHeartbeatLog.recordedAt} < (now() - interval '24 hours')`,
    )
    .returning({ id: projectHeartbeatLog.id });
  const n = deleted.length;
  console.log(
    `${ANSI_DIM}${ANSI_GRAY}[flux] fleet-monitor: pruned ${String(
      n,
    )} telemetry row(s) (recorded before now() - 24h)${ANSI_RESET}`,
  );
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
  if (rows.length > 0) {
    const isProd = process.env.NODE_ENV === "production";
    const now = new Date();
    await Promise.all(
      rows.map(async (row) => {
        const apiUrl = fluxApiUrlForSlug(row.slug, row.hash, isProd);
        const ok = await probeApiUrl(apiUrl);
        const status = ok ? "running" : "error";
        await db
          .update(projects)
          .set({
            healthStatus: status,
            lastHeartbeatAt: now,
          })
          .where(eq(projects.id, row.id));
        await db.insert(projectHeartbeatLog).values({
          projectId: row.id,
          recordedAt: now,
          healthStatus: status,
        });
      }),
    );
  }

  if (Math.random() < PRUNE_PROBABILITY) {
    try {
      await pruneTelemetry();
    } catch (err) {
      console.error("[flux] fleet-monitor: pruneTelemetry failed:", err);
    }
  }
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

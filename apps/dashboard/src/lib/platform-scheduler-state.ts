import { PLATFORM_MINIMUM_BACKUP_FRESHNESS_SCHEDULER_ID } from "@flux/core/backup-policy";
import { eq } from "drizzle-orm";
import { platformSchedulerState } from "@/src/db/schema";
import { getDb } from "@/src/lib/db";

export { PLATFORM_MINIMUM_BACKUP_FRESHNESS_SCHEDULER_ID };

/** True until the platform minimum backup freshness scheduler completes its first tick. */
export async function isPlatformBackupFreshnessSchedulerFirstRun(): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ schedulerId: platformSchedulerState.schedulerId })
    .from(platformSchedulerState)
    .where(
      eq(
        platformSchedulerState.schedulerId,
        PLATFORM_MINIMUM_BACKUP_FRESHNESS_SCHEDULER_ID,
      ),
    )
    .limit(1);
  return !row;
}

/** Mark that the freshness scheduler has executed (bootstrap or steady-state tick). */
export async function recordPlatformBackupFreshnessSchedulerExecution(): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .insert(platformSchedulerState)
    .values({
      schedulerId: PLATFORM_MINIMUM_BACKUP_FRESHNESS_SCHEDULER_ID,
      firstExecutedAt: now,
      lastExecutedAt: now,
    })
    .onConflictDoUpdate({
      target: platformSchedulerState.schedulerId,
      set: { lastExecutedAt: now },
    });
}

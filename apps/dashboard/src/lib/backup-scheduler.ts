import { and, asc, eq, inArray } from "drizzle-orm";
import { resolvePlatformBackupSchedulerBatchSize } from "@flux/core/backup-policy";
import { projectBackups } from "@/src/db/schema";
import { getPlatformBackupPolicy } from "@/src/lib/backup-platform-policy";
import { getDb, initSystemDb } from "@/src/lib/db";
import {
  isPlatformBackupFreshnessSchedulerFirstRun,
  recordPlatformBackupFreshnessSchedulerExecution,
} from "@/src/lib/platform-scheduler-state";
import {
  projectsDueForPlatformBackup,
  replicateBackupOffsite,
  runBackupArtifactValidation,
  runPlatformBackupPipeline,
  sweepRetentionBatch,
} from "@/src/lib/project-backups";

const INTERVAL_MS = 60 * 60 * 1000;
let started = false;

async function markFailed(
  backupId: string,
  field: "status" | "offsite" | "validation",
  error: string,
) {
  const db = getDb();
  if (field === "status") {
    await db
      .update(projectBackups)
      .set({ status: "failed", error })
      .where(eq(projectBackups.id, backupId));
    return;
  }
  if (field === "offsite") {
    await db
      .update(projectBackups)
      .set({ offsiteStatus: "failed", offsiteError: error })
      .where(eq(projectBackups.id, backupId));
    return;
  }
  await db
    .update(projectBackups)
    .set({
      artifactValidationStatus: "artifact_invalid",
      artifactValidationError: error,
      restoreVerificationStatus: "skipped",
      restoreVerificationError: "Skipped because artifact validation failed.",
    })
    .where(eq(projectBackups.id, backupId));
}

export async function processPendingReplicationAndRestore(): Promise<void> {
  const db = getDb();
  const pending = await db
    .select({
      id: projectBackups.id,
      status: projectBackups.status,
      offsiteStatus: projectBackups.offsiteStatus,
      artifactValidationStatus: projectBackups.artifactValidationStatus,
    })
    .from(projectBackups)
    .where(
      and(
        eq(projectBackups.status, "complete"),
        inArray(projectBackups.offsiteStatus, ["pending", "failed"]),
      ),
    )
    .orderBy(asc(projectBackups.createdAt))
    .limit(20);
  for (const row of pending) {
    try {
      await replicateBackupOffsite(row.id);
    } catch (err: unknown) {
      await markFailed(row.id, "offsite", err instanceof Error ? err.message : String(err));
    }
  }
  const validationPending = await db
    .select({ id: projectBackups.id })
    .from(projectBackups)
    .where(
      and(
        eq(projectBackups.status, "complete"),
        inArray(projectBackups.artifactValidationStatus, [
          "pending",
          "artifact_invalid",
        ]),
      ),
    )
    .orderBy(asc(projectBackups.createdAt))
    .limit(20);
  for (const row of validationPending) {
    try {
      await runBackupArtifactValidation(row.id);
    } catch (err: unknown) {
      await markFailed(row.id, "validation", err instanceof Error ? err.message : String(err));
    }
  }
}

export async function runBackupSchedulerTick(): Promise<void> {
  await initSystemDb();
  await processPendingReplicationAndRestore();

  const policy = getPlatformBackupPolicy();
  const isFirstRun = await isPlatformBackupFreshnessSchedulerFirstRun();
  const due = await projectsDueForPlatformBackup();
  const batchSize = resolvePlatformBackupSchedulerBatchSize({
    dueCount: due.length,
    maxPipelinesPerTick: policy.maxPipelinesPerTick,
    bootstrapMaxPipelinesOnFirstRun: policy.bootstrapMaxPipelinesOnFirstRun,
    isFirstRun,
  });
  const batch = due.slice(0, batchSize);

  if (isFirstRun) {
    console.log(
      `[flux] backup-scheduler: first run — running platform minimum backup freshness bootstrap (${String(batch.length)} pipeline(s), ${String(due.length)} due)`,
    );
  }

  for (const project of batch) {
    try {
      await runPlatformBackupPipeline(project);
    } catch (err: unknown) {
      console.error(
        `[flux] backup-scheduler: platform freshness pipeline failed ${project.slug}:${project.hash}`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  try {
    await sweepRetentionBatch(10);
  } catch (err: unknown) {
    console.error(
      "[flux] backup-scheduler: retention sweep failed",
      err instanceof Error ? err.message : String(err),
    );
  }

  await recordPlatformBackupFreshnessSchedulerExecution();
}

export function startBackupScheduler(): void {
  if (started) return;
  started = true;
  console.log(
    "[flux] Backup scheduler starting (60m interval; immediate first tick).",
  );
  void runBackupSchedulerTick().catch((err) => {
    console.error("[flux] backup-scheduler initial tick failed:", err);
  });
  setInterval(() => {
    void runBackupSchedulerTick().catch((err) => {
      console.error("[flux] backup-scheduler tick failed:", err);
    });
  }, INTERVAL_MS);
}

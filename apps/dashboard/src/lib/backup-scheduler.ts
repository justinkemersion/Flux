import { and, asc, eq, inArray } from "drizzle-orm";
import { resolvePlatformBackupSchedulerBatchSize } from "@flux/core/backup-policy";
import { projectBackups } from "@/src/db/schema";
import { getPlatformBackupPolicy } from "@/src/lib/backup-platform-policy";
import {
  logBackupScheduler,
  logBackupSchedulerError,
} from "@/src/lib/backup-scheduler-log";
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

export async function processPendingReplicationAndRestore(): Promise<{
  offsiteProcessed: number;
  validationProcessed: number;
}> {
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
  if (pending.length > 0) {
    logBackupScheduler(
      `retry queue: ${String(pending.length)} backup(s) pending offsite replication`,
    );
  }
  for (const row of pending) {
    try {
      await replicateBackupOffsite(row.id);
      logBackupScheduler(`offsite replication complete backupId=${row.id}`);
    } catch (err: unknown) {
      await markFailed(row.id, "offsite", err instanceof Error ? err.message : String(err));
      logBackupSchedulerError(`offsite replication failed backupId=${row.id}`, err);
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
  if (validationPending.length > 0) {
    logBackupScheduler(
      `retry queue: ${String(validationPending.length)} backup(s) pending artifact validation`,
    );
  }
  for (const row of validationPending) {
    try {
      await runBackupArtifactValidation(row.id);
      logBackupScheduler(`artifact validation complete backupId=${row.id}`);
    } catch (err: unknown) {
      await markFailed(row.id, "validation", err instanceof Error ? err.message : String(err));
      logBackupSchedulerError(`artifact validation failed backupId=${row.id}`, err);
    }
  }
  return {
    offsiteProcessed: pending.length,
    validationProcessed: validationPending.length,
  };
}

export async function runBackupSchedulerTick(): Promise<void> {
  const tickStarted = Date.now();
  await initSystemDb();
  const retry = await processPendingReplicationAndRestore();

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

  logBackupScheduler(
    isFirstRun
      ? `tick start (bootstrap) due=${String(due.length)} batch=${String(batch.length)} maxBootstrap=${String(policy.bootstrapMaxPipelinesOnFirstRun)}`
      : `tick start (steady) due=${String(due.length)} batch=${String(batch.length)} maxPerTick=${String(policy.maxPipelinesPerTick)}`,
  );
  if (batch.length > 0) {
    logBackupScheduler(
      `pipeline queue: ${batch.map((p) => `${p.slug}:${p.hash}`).join(", ")}`,
    );
  } else if (due.length === 0) {
    logBackupScheduler("pipeline queue: empty (all projects platform-fresh or excluded)");
  }

  if (isFirstRun) {
    logBackupScheduler(
      `first run — platform minimum backup freshness bootstrap (${String(batch.length)} pipeline(s), ${String(due.length)} due)`,
    );
  }

  let pipelinesOk = 0;
  let pipelinesFailed = 0;
  for (const project of batch) {
    try {
      await runPlatformBackupPipeline(project);
      pipelinesOk += 1;
    } catch (err: unknown) {
      pipelinesFailed += 1;
      logBackupSchedulerError(
        `platform freshness pipeline failed ${project.slug}:${project.hash}`,
        err,
      );
    }
  }

  let retentionDeleted = 0;
  try {
    retentionDeleted = await sweepRetentionBatch(10);
    if (retentionDeleted > 0) {
      logBackupScheduler(
        `retention sweep deleted ${String(retentionDeleted)} restore-verified backup row(s)`,
      );
    }
  } catch (err: unknown) {
    logBackupSchedulerError("retention sweep failed", err);
  }

  await recordPlatformBackupFreshnessSchedulerExecution();

  const elapsedSec = Math.round((Date.now() - tickStarted) / 1000);
  logBackupScheduler(
    `tick complete elapsed=${String(elapsedSec)}s pipelines ok=${String(pipelinesOk)} failed=${String(pipelinesFailed)} offsiteRetries=${String(retry.offsiteProcessed)} validationRetries=${String(retry.validationProcessed)} retentionDeleted=${String(retentionDeleted)}`,
  );
}

export function startBackupScheduler(): void {
  if (started) return;
  started = true;
  logBackupScheduler("starting (60m interval; immediate first tick)");
  void runBackupSchedulerTick().catch((err) => {
    logBackupSchedulerError("initial tick failed", err);
  });
  setInterval(() => {
    void runBackupSchedulerTick().catch((err) => {
      logBackupSchedulerError("tick failed", err);
    });
  }, INTERVAL_MS);
}

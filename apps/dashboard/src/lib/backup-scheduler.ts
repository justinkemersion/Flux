import { and, asc, eq, inArray } from "drizzle-orm";
import { projectBackups } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";
import {
  createBackupForProject,
  eligibleV1ProjectsForNightly,
  hasBackupToday,
  replicateBackupOffsite,
  runBackupArtifactValidation,
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

async function processPendingReplicationAndRestore(): Promise<void> {
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
  const projects = await eligibleV1ProjectsForNightly();
  for (const project of projects) {
    try {
      const exists = await hasBackupToday(project.id);
      if (exists) continue;
      const backup = await createBackupForProject({
        projectId: project.id,
        slug: project.slug,
        hash: project.hash,
        mode: "v1_dedicated",
      });
      try {
        await replicateBackupOffsite(backup.id);
      } catch (err: unknown) {
        await markFailed(backup.id, "offsite", err instanceof Error ? err.message : String(err));
      }
      try {
        await runBackupArtifactValidation(backup.id);
      } catch (err: unknown) {
        await markFailed(
          backup.id,
          "validation",
          err instanceof Error ? err.message : String(err),
        );
      }
    } catch (err: unknown) {
      console.error(
        `[flux] backup-scheduler: failed project ${project.slug}:${project.hash}`,
        err,
      );
    }
  }
  await processPendingReplicationAndRestore();
}

export function startBackupScheduler(): void {
  if (started) return;
  started = true;
  void runBackupSchedulerTick().catch((err) => {
    console.error("[flux] backup-scheduler initial tick failed:", err);
  });
  setInterval(() => {
    void runBackupSchedulerTick().catch((err) => {
      console.error("[flux] backup-scheduler tick failed:", err);
    });
  }, INTERVAL_MS);
}

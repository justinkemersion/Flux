import { desc, eq } from "drizzle-orm";
import {
  backupCreatedSummary,
  backupVerifiedSummary,
  migrationAppliedSummary,
  projectCreatedSummary,
  sanitizeActivityMetadata,
  tempCredentialSummary,
  type ProjectActivityEvent,
  type ProjectActivityKind,
} from "@flux/core/project-activity";
import { projectActivityEvents } from "@/src/db/schema";
import type { SystemDb } from "@/src/lib/db";

export type RecordProjectActivityInput = {
  projectId: string;
  userId?: string | null;
  kind: ProjectActivityKind;
  summary: string;
  metadata?: Record<string, unknown>;
};

export async function recordProjectActivity(
  db: SystemDb,
  input: RecordProjectActivityInput,
): Promise<void> {
  const metadata = sanitizeActivityMetadata(input.metadata);
  await db.insert(projectActivityEvents).values({
    projectId: input.projectId,
    userId: input.userId ?? null,
    kind: input.kind,
    summary: input.summary.trim(),
    metadata,
  });
}

/** Best-effort activity write — never throws to callers. */
export async function tryRecordProjectActivity(
  db: SystemDb,
  input: RecordProjectActivityInput,
): Promise<void> {
  try {
    await recordProjectActivity(db, input);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[flux] project activity record failed kind=${input.kind} project=${input.projectId}: ${msg}`,
    );
  }
}

export async function recordProjectCreatedActivity(
  db: SystemDb,
  input: {
    projectId: string;
    userId: string;
    slug: string;
    hash: string;
    mode: string;
  },
): Promise<void> {
  await tryRecordProjectActivity(db, {
    projectId: input.projectId,
    userId: input.userId,
    kind: "project.created",
    summary: projectCreatedSummary(input.slug),
    metadata: { slug: input.slug, hash: input.hash, mode: input.mode },
  });
}

export async function recordMigrationAppliedActivity(
  db: SystemDb,
  input: {
    projectId: string;
    userId: string;
    filename: string;
    version: string;
    skipped?: boolean;
  },
): Promise<void> {
  if (input.skipped) return;
  await tryRecordProjectActivity(db, {
    projectId: input.projectId,
    userId: input.userId,
    kind: "migration.applied",
    summary: migrationAppliedSummary(input.filename),
    metadata: { filename: input.filename, version: input.version },
  });
}

export async function recordBackupCreatedActivity(
  db: SystemDb,
  input: {
    projectId: string;
    userId: string;
    backupId: string;
    kind: string;
  },
): Promise<void> {
  await tryRecordProjectActivity(db, {
    projectId: input.projectId,
    userId: input.userId,
    kind: "backup.created",
    summary: backupCreatedSummary(input.kind),
    metadata: { backupId: input.backupId, kind: input.kind },
  });
}

export async function recordBackupVerifiedActivity(
  db: SystemDb,
  input: { projectId: string; userId: string; backupId: string },
): Promise<void> {
  await tryRecordProjectActivity(db, {
    projectId: input.projectId,
    userId: input.userId,
    kind: "backup.verified",
    summary: backupVerifiedSummary(),
    metadata: { backupId: input.backupId },
  });
}

export async function recordTempCredentialActivity(
  db: SystemDb,
  input: {
    projectId: string;
    userId: string;
    access: string;
    ttlSeconds: number;
  },
): Promise<void> {
  await tryRecordProjectActivity(db, {
    projectId: input.projectId,
    userId: input.userId,
    kind: "db.temp_credential_issued",
    summary: tempCredentialSummary(input.access, input.ttlSeconds),
    metadata: { access: input.access, ttlSeconds: input.ttlSeconds },
  });
}

export async function listProjectActivityEvents(
  db: SystemDb,
  projectId: string,
  limit = 50,
): Promise<ProjectActivityEvent[]> {
  const capped = Math.min(Math.max(limit, 1), 100);
  const rows = await db
    .select({
      id: projectActivityEvents.id,
      projectId: projectActivityEvents.projectId,
      userId: projectActivityEvents.userId,
      kind: projectActivityEvents.kind,
      summary: projectActivityEvents.summary,
      metadata: projectActivityEvents.metadata,
      createdAt: projectActivityEvents.createdAt,
    })
    .from(projectActivityEvents)
    .where(eq(projectActivityEvents.projectId, projectId))
    .orderBy(desc(projectActivityEvents.createdAt))
    .limit(capped);

  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    userId: r.userId,
    kind: r.kind as ProjectActivityKind,
    summary: r.summary,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    createdAt: r.createdAt.toISOString(),
  }));
}

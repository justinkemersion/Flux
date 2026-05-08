import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { and, desc, eq, gte } from "drizzle-orm";
import { projectBackups, projects } from "@/src/db/schema";
import { getBackupStorage } from "@/src/lib/backup-storage";
import { getDb } from "@/src/lib/db";
import { getProjectManager } from "@/src/lib/flux";

export type BackupRow = typeof projectBackups.$inferSelect;
const execFileAsync = promisify(execFile);

function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function listBackupsForProject(
  projectId: string,
): Promise<BackupRow[]> {
  const db = getDb();
  return db
    .select()
    .from(projectBackups)
    .where(eq(projectBackups.projectId, projectId))
    .orderBy(desc(projectBackups.createdAt));
}

export async function createBackupForProject(input: {
  projectId: string;
  slug: string;
  hash: string;
}): Promise<BackupRow> {
  const db = getDb();
  const storage = getBackupStorage();
  await storage.ensureRoots();

  const [queued] = await db
    .insert(projectBackups)
    .values({
      projectId: input.projectId,
      localPath: "",
      status: "queued",
      offsiteStatus: "pending",
      artifactValidationStatus: "pending",
      restoreVerificationStatus: "pending",
    })
    .returning();
  if (!queued) {
    throw new Error("Failed to create backup queue row.");
  }

  const localPath = storage.localPathForBackup(input.projectId, queued.id);
  await mkdir(path.dirname(localPath), {
    recursive: true,
  });

  await db
    .update(projectBackups)
    .set({ status: "running", localPath, error: null })
    .where(eq(projectBackups.id, queued.id));

  try {
    const pm = getProjectManager();
    const stream = await pm.getProjectCustomBackupStream(input.slug, input.hash);
    const hash = createHash("sha256");
    const sink = createWriteStream(localPath);
    stream.on("data", (chunk: Buffer | string | Uint8Array) => {
      hash.update(chunk);
    });
    await pipeline(stream, sink);
    const fs = await stat(localPath);
    const checksumSha256 = hash.digest("hex");

    const [completed] = await db
      .update(projectBackups)
      .set({
        status: "complete",
        sizeBytes: Number(fs.size),
        checksumSha256,
        completedAt: new Date(),
      })
      .where(eq(projectBackups.id, queued.id))
      .returning();
    if (!completed) {
      throw new Error("Backup row missing after completion.");
    }
    return completed;
  } catch (err: unknown) {
    await db
      .update(projectBackups)
      .set({ status: "failed", error: err instanceof Error ? err.message : String(err) })
      .where(eq(projectBackups.id, queued.id));
    throw err;
  }
}

export async function replicateBackupOffsite(backupId: string): Promise<void> {
  const db = getDb();
  const storage = getBackupStorage();
  const [backup] = await db
    .select()
    .from(projectBackups)
    .where(eq(projectBackups.id, backupId))
    .limit(1);
  if (!backup) return;
  if (backup.status !== "complete") return;
  if (backup.offsiteStatus === "complete") return;
  const offsiteKey = `${backup.projectId}/${backup.id}.dump`;
  await db
    .update(projectBackups)
    .set({ offsiteStatus: "running", offsiteError: null, offsiteKey })
    .where(eq(projectBackups.id, backup.id));
  await storage.uploadOffsite(backup.localPath, offsiteKey);
  await db
    .update(projectBackups)
    .set({
      offsiteStatus: "complete",
      offsiteCompletedAt: new Date(),
    })
    .where(eq(projectBackups.id, backup.id));
}

export async function runBackupArtifactValidation(backupId: string): Promise<void> {
  const db = getDb();
  const [backup] = await db
    .select()
    .from(projectBackups)
    .where(eq(projectBackups.id, backupId))
    .limit(1);
  if (!backup) return;
  if (backup.status !== "complete") return;
  await db
    .update(projectBackups)
    .set({ artifactValidationStatus: "running", artifactValidationError: null })
    .where(eq(projectBackups.id, backup.id));
  const fs = await stat(backup.localPath);
  if (!fs.isFile() || fs.size <= 0) {
    throw new Error("Backup artifact is missing or empty.");
  }
  await db
    .update(projectBackups)
    .set({
      artifactValidationStatus: "artifact_verified",
      artifactValidationAt: new Date(),
    })
    .where(eq(projectBackups.id, backup.id));
}

async function runDocker(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("docker", args, { maxBuffer: 10 * 1024 * 1024 });
  return stdout.toString().trim();
}

async function waitForPgReady(containerName: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await runDocker(["exec", containerName, "pg_isready", "-U", "postgres"]);
      return;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for disposable Postgres to become ready.");
}

export async function verifyBackupRestore(backupId: string): Promise<void> {
  const db = getDb();
  const [backup] = await db
    .select()
    .from(projectBackups)
    .where(eq(projectBackups.id, backupId))
    .limit(1);
  if (!backup) throw new Error("Backup not found.");
  if (backup.status !== "complete") {
    throw new Error("Backup must be complete before restore verification.");
  }
  const fs = await stat(backup.localPath);
  if (!fs.isFile() || fs.size <= 0) {
    throw new Error("Backup file does not exist or is empty.");
  }

  const verifyPassword = crypto.randomUUID().replace(/-/g, "");
  const verifyName = `flux-backup-verify-${backup.id.slice(0, 12)}`;
  const image = process.env.FLUX_BACKUP_VERIFY_POSTGRES_IMAGE?.trim() || "postgres:16-alpine";

  await db
    .update(projectBackups)
    .set({
      restoreVerificationStatus: "running",
      restoreVerificationError: null,
    })
    .where(eq(projectBackups.id, backup.id));

  let created = false;
  try {
    await runDocker([
      "run",
      "--rm",
      "--name",
      verifyName,
      "-d",
      "-e",
      `POSTGRES_PASSWORD=${verifyPassword}`,
      "-v",
      `${backup.localPath}:/tmp/backup.dump:ro`,
      image,
    ]);
    created = true;
    await waitForPgReady(verifyName, 30_000);

    await runDocker([
      "exec",
      "-e",
      `PGPASSWORD=${verifyPassword}`,
      verifyName,
      "pg_restore",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "--no-owner",
      "--no-acl",
      "/tmp/backup.dump",
    ]);
    const tableCountRaw = await runDocker([
      "exec",
      "-e",
      `PGPASSWORD=${verifyPassword}`,
      verifyName,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-t",
      "-A",
      "-c",
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema');",
    ]);
    const tableCount = Number.parseInt(tableCountRaw.trim(), 10);
    if (!Number.isFinite(tableCount) || tableCount <= 0) {
      throw new Error(
        "Restore verification failed: no user tables found after pg_restore.",
      );
    }
    await runDocker([
      "exec",
      "-e",
      `PGPASSWORD=${verifyPassword}`,
      verifyName,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast');",
    );
    await db
      .update(projectBackups)
      .set({
        restoreVerificationStatus: "restore_verified",
        restoreVerificationAt: new Date(),
      })
      .where(eq(projectBackups.id, backup.id));
  } catch (err: unknown) {
    await db
      .update(projectBackups)
      .set({
        restoreVerificationStatus: "failed",
        restoreVerificationError: err instanceof Error ? err.message : String(err),
      })
      .where(eq(projectBackups.id, backup.id));
    throw err;
  } finally {
    if (created) {
      try {
        await runDocker(["rm", "-f", verifyName]);
      } catch {
        // Container may already be removed; ignore cleanup failures.
      }
    }
  }
}

export async function streamBackupFile(backupId: string): Promise<{
  backup: BackupRow;
  stream: ReturnType<typeof createReadStream>;
}> {
  const db = getDb();
  const [backup] = await db
    .select()
    .from(projectBackups)
    .where(eq(projectBackups.id, backupId))
    .limit(1);
  if (!backup) {
    throw new Error("Backup not found.");
  }
  if (backup.status !== "complete") {
    throw new Error("Backup is not ready for download.");
  }
  return { backup, stream: createReadStream(backup.localPath) };
}

export async function latestBackupForProject(projectId: string): Promise<BackupRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(projectBackups)
    .where(eq(projectBackups.projectId, projectId))
    .orderBy(desc(projectBackups.createdAt))
    .limit(1);
  return row ?? null;
}

export async function eligibleV1ProjectsForNightly(): Promise<
  Array<{ id: string; slug: string; hash: string }>
> {
  const db = getDb();
  return db
    .select({ id: projects.id, slug: projects.slug, hash: projects.hash })
    .from(projects)
    .where(eq(projects.mode, "v1_dedicated"));
}

export async function hasBackupToday(projectId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ id: projectBackups.id })
    .from(projectBackups)
    .where(
      and(
        eq(projectBackups.projectId, projectId),
        gte(projectBackups.createdAt, startOfUtcDay()),
      ),
    )
    .limit(1);
  return Boolean(row);
}

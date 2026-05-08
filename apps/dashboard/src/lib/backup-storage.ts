import { mkdir, stat as fsStat, copyFile } from "node:fs/promises";
import path from "node:path";

export type OffsiteUploadResult = {
  offsiteKey: string;
};

export interface BackupStorage {
  ensureRoots(): Promise<void>;
  localPathForBackup(projectId: string, backupId: string): string;
  uploadOffsite(localPath: string, offsiteKey: string): Promise<OffsiteUploadResult>;
}

export type BackupStorageConfig = {
  localRoot: string;
  offsiteRoot: string;
};

function offsiteKeyToPath(root: string, offsiteKey: string): string {
  const safe = offsiteKey
    .split("/")
    .map((segment) => segment.replace(/[^a-zA-Z0-9._-]/g, "_"))
    .join("/");
  return path.join(root, safe);
}

class FilesystemBackupStorage implements BackupStorage {
  constructor(private readonly config: BackupStorageConfig) {}

  async ensureRoots(): Promise<void> {
    try {
      await mkdir(this.config.localRoot, { recursive: true });
      await mkdir(this.config.offsiteRoot, { recursive: true });
    } catch (err: unknown) {
      const code =
        err && typeof err === "object" && "code" in err
          ? (err as NodeJS.ErrnoException).code
          : undefined;
      const msg = err instanceof Error ? err.message : String(err);
      if (code === "EACCES" || code === "EPERM") {
        throw new Error(
          `Backup storage is not writable (${code}): cannot create ${this.config.localRoot} or ${this.config.offsiteRoot}. ` +
            `Set FLUX_BACKUPS_LOCAL_DIR and FLUX_BACKUPS_OFFSITE_DIR to directories the control-plane process can write ` +
            `(e.g. Docker: mount volumes and use flux-web-entrypoint.sh, or chown the paths to uid 1001). Original: ${msg}`,
        );
      }
      throw err;
    }
  }

  localPathForBackup(projectId: string, backupId: string): string {
    return path.join(this.config.localRoot, projectId, `${backupId}.dump`);
  }

  async uploadOffsite(localPath: string, offsiteKey: string): Promise<OffsiteUploadResult> {
    const src = await fsStat(localPath);
    if (!src.isFile()) {
      throw new Error(`Backup file missing: ${localPath}`);
    }
    const dest = offsiteKeyToPath(this.config.offsiteRoot, offsiteKey);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(localPath, dest);
    return { offsiteKey };
  }
}

export function getBackupStorage(): BackupStorage {
  return new FilesystemBackupStorage({
    localRoot: process.env.FLUX_BACKUPS_LOCAL_DIR?.trim() || "/srv/flux/backups",
    offsiteRoot:
      process.env.FLUX_BACKUPS_OFFSITE_DIR?.trim() || "/srv/flux/backups-offsite",
  });
}

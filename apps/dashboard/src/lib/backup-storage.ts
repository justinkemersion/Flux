import { mkdir, stat as fsStat, copyFile } from "node:fs/promises";
import path from "node:path";
import {
  parseOffsiteStorageConfig,
  S3OffsiteClient,
  type OffsiteUploadResult as CoreOffsiteUploadResult,
} from "@flux/core/offsite-storage";

export type OffsiteUploadResult = CoreOffsiteUploadResult;

export interface BackupStorage {
  ensureRoots(): Promise<void>;
  /** Resolved FLUX_BACKUPS_LOCAL_DIR (absolute). */
  absoluteLocalRoot(): string;
  localPathForBackup(projectId: string, backupId: string): string;
  uploadOffsite(
    localPath: string,
    offsiteKey: string,
    contentSha256?: string | null,
  ): Promise<OffsiteUploadResult>;
  /** True when R2/S3 offsite replication is configured. */
  usesR2Offsite(): boolean;
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

  private resolvedLocalRoot(): string {
    return path.resolve(this.config.localRoot);
  }

  private resolvedOffsiteRoot(): string {
    return path.resolve(this.config.offsiteRoot);
  }

  absoluteLocalRoot(): string {
    return this.resolvedLocalRoot();
  }

  usesR2Offsite(): boolean {
    return false;
  }

  async ensureRoots(): Promise<void> {
    try {
      await mkdir(this.resolvedLocalRoot(), { recursive: true });
      await mkdir(this.resolvedOffsiteRoot(), { recursive: true });
    } catch (err: unknown) {
      const code =
        err && typeof err === "object" && "code" in err
          ? (err as NodeJS.ErrnoException).code
          : undefined;
      const msg = err instanceof Error ? err.message : String(err);
      if (code === "EACCES" || code === "EPERM") {
        throw new Error(
          `Backup storage is not writable (${code}): cannot create ${this.resolvedLocalRoot()} or ${this.resolvedOffsiteRoot()}. ` +
            `Set FLUX_BACKUPS_LOCAL_DIR and FLUX_BACKUPS_OFFSITE_DIR to directories the control-plane process can write ` +
            `(e.g. Docker: mount volumes and use flux-web-entrypoint.sh, or chown the paths to uid 1001). Original: ${msg}`,
        );
      }
      throw err;
    }
  }

  localPathForBackup(projectId: string, backupId: string): string {
    return path.join(this.resolvedLocalRoot(), projectId, `${backupId}.dump`);
  }

  async uploadOffsite(
    localPath: string,
    offsiteKey: string,
    _contentSha256?: string | null,
  ): Promise<OffsiteUploadResult> {
    const src = await fsStat(localPath);
    if (!src.isFile()) {
      throw new Error(`Backup file missing: ${localPath}`);
    }
    const dest = offsiteKeyToPath(this.resolvedOffsiteRoot(), offsiteKey);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(localPath, dest);
    return {
      provider: "filesystem",
      bucket: "filesystem",
      offsiteKey,
      sizeBytes: Number(src.size),
    };
  }
}

class R2BackupStorage implements BackupStorage {
  private readonly s3: S3OffsiteClient;

  constructor(
    private readonly localRoot: string,
    private readonly s3Client: S3OffsiteClient,
  ) {
    this.s3 = s3Client;
  }

  absoluteLocalRoot(): string {
    return path.resolve(this.localRoot);
  }

  usesR2Offsite(): boolean {
    return true;
  }

  async ensureRoots(): Promise<void> {
    try {
      await mkdir(this.absoluteLocalRoot(), { recursive: true });
    } catch (err: unknown) {
      const code =
        err && typeof err === "object" && "code" in err
          ? (err as NodeJS.ErrnoException).code
          : undefined;
      const msg = err instanceof Error ? err.message : String(err);
      if (code === "EACCES" || code === "EPERM") {
        throw new Error(
          `Backup storage is not writable (${code}): cannot create ${this.absoluteLocalRoot()}. ` +
            `Set FLUX_BACKUPS_LOCAL_DIR to a directory the control-plane process can write. Original: ${msg}`,
        );
      }
      throw err;
    }
  }

  localPathForBackup(projectId: string, backupId: string): string {
    return path.join(this.absoluteLocalRoot(), projectId, `${backupId}.dump`);
  }

  async uploadOffsite(
    localPath: string,
    offsiteKey: string,
    contentSha256?: string | null,
  ): Promise<OffsiteUploadResult> {
    return this.s3.putObjectFromFile(localPath, offsiteKey, contentSha256);
  }
}

let cachedStorage: BackupStorage | null = null;

export function isR2OffsiteEnabled(): boolean {
  return parseOffsiteStorageConfig() !== null;
}

export function isR2OffsiteStrict(): boolean {
  return parseOffsiteStorageConfig()?.strict === true;
}

export function getBackupStorage(): BackupStorage {
  if (cachedStorage) return cachedStorage;

  const localRoot =
    process.env.FLUX_BACKUPS_LOCAL_DIR?.trim() || "/srv/flux/backups";
  const offsiteConfig = parseOffsiteStorageConfig();

  if (offsiteConfig) {
    cachedStorage = new R2BackupStorage(
      localRoot,
      new S3OffsiteClient(offsiteConfig),
    );
  } else {
    cachedStorage = new FilesystemBackupStorage({
      localRoot,
      offsiteRoot:
        process.env.FLUX_BACKUPS_OFFSITE_DIR?.trim() ||
        "/srv/flux/backups-offsite",
    });
  }

  return cachedStorage;
}

/** Test hook — reset singleton between tests. */
export function resetBackupStorageForTests(): void {
  cachedStorage = null;
}

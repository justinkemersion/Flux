import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

export type BackupArtifactProbeInput = {
  localPath: string;
  checksumSha256?: string | null;
  sizeBytes?: number | null;
};

export type BackupArtifactProbeResult =
  | { ok: true }
  | { ok: false; artifactError: string };

function isEnoent(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function sha256HexOfFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

/**
 * Check that a completed backup artifact exists on disk and matches catalog checksum/size.
 * Used by backup list reconciliation so CLI/UI trust layer reflects storage truth.
 */
export async function probeBackupArtifactOnDisk(
  row: BackupArtifactProbeInput,
): Promise<BackupArtifactProbeResult> {
  const rawPath = row.localPath?.trim();
  if (!rawPath) {
    return { ok: false, artifactError: "No local_path recorded for backup." };
  }

  try {
    const st = await stat(rawPath);
    if (!st.isFile()) {
      return { ok: false, artifactError: "Backup artifact path is not a file." };
    }
    if (st.size <= 0) {
      return { ok: false, artifactError: "Backup artifact is empty on disk." };
    }
    if (
      row.sizeBytes != null &&
      Number.isFinite(row.sizeBytes) &&
      st.size !== row.sizeBytes
    ) {
      return {
        ok: false,
        artifactError: `Backup artifact size mismatch (disk ${String(st.size)} vs catalog ${String(row.sizeBytes)}).`,
      };
    }

    const expected = row.checksumSha256?.trim().toLowerCase();
    if (expected && /^[a-f0-9]{64}$/u.test(expected)) {
      const actual = (await sha256HexOfFile(rawPath)).toLowerCase();
      if (actual !== expected) {
        return { ok: false, artifactError: "Backup artifact checksum mismatch." };
      }
    }
    return { ok: true };
  } catch (err: unknown) {
    if (isEnoent(err)) {
      return {
        ok: false,
        artifactError: "Backup artifact file not found on disk.",
      };
    }
    throw err;
  }
}

import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import {
  backupTrustTierLabelForKind,
  classifyNewestBackup,
} from "@flux/core/backup-trust";
import chalk from "chalk";
import { getApiClient } from "../api-client";
import { sectionBanner } from "../cli-layout";
import type { FluxJson } from "../flux-config";
import { resolveHash, resolveOptionalName } from "../project-resolve";
import { printBackupTrustSummary } from "./backup-gate";

function fmtBytes(n: number | null | undefined): string {
  if (!Number.isFinite(n ?? NaN) || (n ?? 0) < 0) return "-";
  const v = Number(n);
  if (v < 1024) return `${String(v)} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KiB`;
  if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(v / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

/** Trim long `<projectId>/<backupId>.dump` for verbose table cells. */
function fmtArtifactRelPath(p: string | undefined): string {
  const s = (p ?? "").trim() || "-";
  if (s.length <= 44) return s.padEnd(44);
  return `${s.slice(0, 18)}…${s.slice(-23)}`;
}

export async function cmdBackupCreate(
  name: string | undefined,
  projectOpt: string | undefined,
  cliHash: string | undefined,
  flux: FluxJson | null,
): Promise<void> {
  const fromCli = projectOpt?.trim() || name;
  const slug = resolveOptionalName(fromCli, flux, "positional [name] or -p, --project");
  const hash = resolveHash(cliHash, flux);
  const client = getApiClient();
  console.log(chalk.blue(`Creating backup for ${chalk.bold(slug)}...`));
  const backup = await client.createProjectBackup(hash);
  console.log(chalk.green("✓"), chalk.white("Backup complete."));
  console.log(
    chalk.dim(
      `  id=${backup.id} kind=${backup.kind ?? "project_db"} status=${backup.status} size=${fmtBytes(backup.sizeBytes ?? null)}`,
    ),
  );
}

export async function cmdBackupList(
  name: string | undefined,
  projectOpt: string | undefined,
  cliHash: string | undefined,
  verbose: boolean,
  flux: FluxJson | null,
): Promise<void> {
  const fromCli = projectOpt?.trim() || name;
  resolveOptionalName(fromCli, flux, "positional [name] or -p, --project");
  const hash = resolveHash(cliHash, flux);
  const client = getApiClient();
  const { backups, reconciledAt, backupVolumeAbsoluteRoot } =
    await client.listProjectBackups(hash);
  sectionBanner("Backups");
  const classification = classifyNewestBackup(backups);
  printBackupTrustSummary(classification, backups[0]?.kind);
  if (verbose) {
    if (reconciledAt) {
      console.log(
        chalk.dim(`  Checked artifacts on server at ${reconciledAt}.`),
      );
    }
    if (backupVolumeAbsoluteRoot) {
      console.log(
        chalk.dim(`  Backup volume root on API server: ${backupVolumeAbsoluteRoot}`),
      );
    }
    if (backups[0]?.primaryArtifactAbsolutePath) {
      console.log(
        chalk.dim(`  Newest artifact (absolute on API server): ${backups[0].primaryArtifactAbsolutePath}`),
      );
    }
    if (backups[0]?.primaryArtifactRelativePath) {
      console.log(
        chalk.dim(`  Relative to volume root: ${backups[0].primaryArtifactRelativePath}`),
      );
    }
    console.log(
      chalk.dim(
        "  Host ls at the volume path can be empty when flux-web uses a Docker named volume — dumps live inside the volume; use docker exec against flux-web or bind-mount for host-visible files.",
      ),
    );
  }
  console.log();
  if (backups.length === 0) {
    console.log(chalk.dim("  No backup rows yet."));
    return;
  }
  if (verbose) {
    console.log(
      chalk.dim(
        "  ID                                   KIND       STATUS     SIZE       CREATED                    VALIDATION        RESTORE_VERIFY   ARTIFACT_REL_PATH",
      ),
    );
    for (const row of backups) {
      const kindCell = (row.kind ?? "project_db").padEnd(10);
      console.log(
        `  ${chalk.cyan(row.id.padEnd(36))} ${kindCell} ${String(row.status).padEnd(10)} ${fmtBytes(row.sizeBytes ?? null).padEnd(10)} ${(row.createdAt ?? "-").padEnd(25)} ${String(row.artifactValidationStatus ?? "pending").padEnd(17)} ${String(row.restoreVerificationStatus ?? "pending").padEnd(16)} ${fmtArtifactRelPath(row.primaryArtifactRelativePath)}`,
      );
    }
    return;
  }
  console.log(
    chalk.dim(
      "  History (newest first) — use --verbose for reconcile/paths detail + full technical columns",
    ),
  );
  console.log(chalk.dim("  ID                                   CREATED                    TRUST"));
  for (let i = 0; i < backups.length; i++) {
    const row = backups[i]!;
    const rowTrust = classifyNewestBackup([row]);
    const trustShort = backupTrustTierLabelForKind(row.kind ?? "project_db", rowTrust.tier);
    const line = `  ${row.id.padEnd(36)} ${(row.createdAt ?? "-").padEnd(25)} ${trustShort}`;
    console.log(i === 0 ? line : chalk.dim(line));
  }
}

export async function cmdBackupDownload(
  name: string | undefined,
  projectOpt: string | undefined,
  cliHash: string | undefined,
  backupId: string | undefined,
  latest: boolean,
  outputPath: string | undefined,
  flux: FluxJson | null,
): Promise<void> {
  const fromCli = projectOpt?.trim() || name;
  const slug = resolveOptionalName(fromCli, flux, "positional [name] or -p, --project");
  const hash = resolveHash(cliHash, flux);
  const client = getApiClient();
  let targetId = (backupId ?? "").trim();
  if (latest) {
    const { backups: rows } = await client.listProjectBackups(hash);
    if (rows.length === 0) {
      throw new Error("No backups available to download.");
    }
    targetId = rows[0]!.id;
  }
  if (!targetId) {
    throw new Error("Provide --id <backupId> or --latest.");
  }
  const out = outputPath?.trim();
  if (!out && process.stdout.isTTY) {
    throw new Error(
      "Refusing to write a binary pg_dump archive to a terminal. Use:\n" +
        `  flux backup download -p ${slug} --hash ${hash} --id ${targetId} -o ./backup.dump\n` +
        "or redirect: flux backup download ... > backup.dump",
    );
  }
  process.stderr.write(`Downloading backup ${targetId} for ${slug} (${hash})...\n`);
  const webStream = await client.getProjectBackupStream({ hash, backupId: targetId });
  const nodeStream = Readable.fromWeb(
    webStream as import("node:stream/web").ReadableStream,
  );
  if (out) {
    await pipeline(nodeStream, createWriteStream(out));
  } else {
    for await (const chunk of nodeStream) {
      if (!process.stdout.write(chunk)) {
        await once(process.stdout, "drain");
      }
    }
  }
  process.stderr.write("Download complete.\n");
}

export async function cmdBackupVerify(
  name: string | undefined,
  projectOpt: string | undefined,
  cliHash: string | undefined,
  backupId: string | undefined,
  latest: boolean,
  flux: FluxJson | null,
): Promise<void> {
  const fromCli = projectOpt?.trim() || name;
  const slug = resolveOptionalName(fromCli, flux, "positional [name] or -p, --project");
  const hash = resolveHash(cliHash, flux);
  const client = getApiClient();
  let id = (backupId ?? "").trim();
  if (latest) {
    const { backups: rows } = await client.listProjectBackups(hash);
    if (rows.length === 0) {
      throw new Error("No backups available to verify.");
    }
    id = rows[0]!.id;
  }
  if (!id) throw new Error("Provide --id <backupId> or --latest.");
  console.log(chalk.blue(`Verifying restore for backup ${chalk.bold(id)} on ${chalk.bold(slug)}...`));
  const result = await client.verifyProjectBackup({ hash, backupId: id });
  console.log(chalk.green("✓"), chalk.white(`Restore verification: ${result.restoreVerificationStatus}`));
}

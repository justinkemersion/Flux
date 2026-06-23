import {
  backupTrustTierLabelForKind,
  BACKUP_TRUST_REMEDIATION_CLI,
  classifyNewestBackup,
  destructiveBackupCheckMessage,
  formatBackupTrustSummary,
  type BackupKind,
  type BackupTrustClassification,
} from "@flux/core/backup-trust";
import chalk from "chalk";
import { getApiClient } from "../api-client";
import { isCliAdmin } from "../utils/cli-audience";
import { formatCliTimestampDisplay } from "../utils/cli-timestamp.js";

export async function ensureRestoreVerifiedLatestBackup(
  client: ReturnType<typeof getApiClient>,
  hash: string,
  skipBackupCheck: boolean,
): Promise<void> {
  if (skipBackupCheck) return;
  await client.getProjectMetadata(hash);
  const { backups } = await client.listProjectBackups(hash);
  const c = classifyNewestBackup(backups);
  if (!c.allowsDestructiveWithoutOverride) {
    throw new Error(destructiveBackupCheckMessage(c));
  }
}

function printBackupStatusBlock(
  classification: BackupTrustClassification,
  kind: BackupKind,
  latestCreatedAt?: string | null,
): void {
  const summary = formatBackupTrustSummary({
    classification,
    kind,
    latestBackupCreatedAt: latestCreatedAt ?? null,
  });
  const labelWidth = 28;
  const pad = (s: string) => s.padEnd(labelWidth);
  const latestBackup =
    latestCreatedAt == null || latestCreatedAt === ""
      ? summary.latestBackup
      : formatCliTimestampDisplay(latestCreatedAt);
  console.log(chalk.dim(`  ${pad("Latest backup:")}${latestBackup}`));
  console.log(chalk.dim(`  ${pad("Verification:")}${summary.verification}`));
  const destructiveLine = summary.safeDestructive;
  const destructiveColor = classification.allowsDestructiveWithoutOverride
    ? chalk.green(destructiveLine)
    : chalk.yellow(destructiveLine);
  console.log(
    chalk.dim(`  ${pad("Safe destructive actions:")}`) + destructiveColor,
  );
  if (summary.actionHint) {
    console.log(chalk.dim(`  ${pad("Action:")}${summary.actionHint}`));
  }
}

export function printBackupTrustSummary(
  classification: ReturnType<typeof classifyNewestBackup>,
  kind?: "project_db" | "tenant_export" | null,
  latestCreatedAt?: string | null,
): void {
  const k = kind ?? "project_db";
  printBackupStatusBlock(classification, k, latestCreatedAt);

  if (!isCliAdmin() && classification.tier !== "restore_failed") {
    return;
  }

  console.log();
  const label = backupTrustTierLabelForKind(k, classification.tier);
  if (classification.tier === "restorable") {
    console.log(
      chalk.green("✓") +
        chalk.white(" ") +
        chalk.green.bold(label) +
        chalk.white(" (") +
        chalk.dim("restore_verified") +
        chalk.white(")."),
    );
    console.log(
      chalk.dim(
        k === "tenant_export"
          ? "  This project has a verified restorable tenant export."
          : "  This project has a verified restorable backup.",
      ),
    );
    return;
  }
  if (classification.tier === "restore_failed") {
    console.log(
      chalk.red("✗"),
      chalk.white.bold(label),
      chalk.dim(` — ${classification.detail}`),
    );
  } else if (classification.tier === "not_restore_verified") {
    console.log(
      chalk.yellow("⚠"),
      chalk.white.bold(label),
      chalk.dim(` — ${classification.detail}`),
    );
  } else if (classification.tier === "artifact_pending") {
    console.log(
      chalk.blue("⋯"),
      chalk.white.bold(label),
      chalk.dim(` — ${classification.detail}`),
    );
    console.log(
      chalk.dim("  Try listing backups again shortly if catalog validation has not caught up."),
    );
    return;
  } else {
    console.log(
      chalk.yellow("⚠"),
      chalk.white(label + "."),
      chalk.dim(` ${classification.detail}`),
    );
  }
  console.log(chalk.dim(`  Next: ${BACKUP_TRUST_REMEDIATION_CLI}`));
}

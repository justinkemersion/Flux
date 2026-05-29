import {
  backupTrustTierLabelForKind,
  BACKUP_TRUST_REMEDIATION_CLI,
  classifyNewestBackup,
  destructiveBackupCheckMessage,
} from "@flux/core/backup-trust";
import chalk from "chalk";
import { getApiClient } from "../api-client";
import { isCliAdmin } from "../utils/cli-audience";

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

export function printBackupTrustSummary(
  classification: ReturnType<typeof classifyNewestBackup>,
  kind?: "project_db" | "tenant_export" | null,
): void {
  if (!isCliAdmin() && classification.tier !== "restore_failed") {
    return;
  }
  const k = kind ?? "project_db";
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

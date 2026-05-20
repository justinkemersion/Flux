import {
  migrationConflictMessage,
  type MigrationPlanResult,
} from "@flux/core/sql-migrations";
import type { FluxMigrationRecord } from "@flux/core/sql-migrations";
import chalk from "chalk";

export const MIGRATION_EDIT_RULE =
  "Do not edit a migration after it has been applied. Create a new migration instead.";

export type MigrationPushMode = "apply" | "plan" | "dry-run";

const MAX_SQL_BYTES = 4 * 1024 * 1024;

export function assertMigrationPlanReadyForDryRun(
  plan: MigrationPlanResult,
): void {
  for (const { file, appliedChecksum } of plan.conflicts) {
    throw new Error(migrationConflictMessage(file, appliedChecksum));
  }
  for (const file of plan.apply) {
    if (Buffer.byteLength(file.content, "utf8") > MAX_SQL_BYTES) {
      throw new Error(
        `${file.filename} is larger than 4 MiB (server limit for flux push).`,
      );
    }
  }
}

export function printMigrationPlan(input: {
  plan: MigrationPlanResult;
  mode: MigrationPushMode;
}): { wouldApply: number; wouldSkip: number; conflicts: number } {
  const { plan, mode } = input;
  const isPreview = mode === "plan" || mode === "dry-run";

  for (const file of plan.skip) {
    const label = isPreview ? "already applied" : "already applied";
    console.log(chalk.green("✓"), chalk.white(`${file.filename} ${label}`));
  }

  for (const { file } of plan.conflicts) {
    console.log(chalk.red("✗"), chalk.white(`${file.filename} checksum conflict`));
    if (mode === "plan") {
      console.log(chalk.dim("  (run without --plan to see full details on failure)"));
    }
  }

  for (const file of plan.apply) {
    if (isPreview) {
      console.log(
        chalk.blue("→"),
        chalk.white(`${file.filename} would apply`),
      );
    } else {
      console.log(
        chalk.blue("→"),
        chalk.white(`${file.filename} applying...`),
      );
    }
  }

  return {
    wouldApply: plan.apply.length,
    wouldSkip: plan.skip.length,
    conflicts: plan.conflicts.length,
  };
}

export function printMigrationPlanSummary(input: {
  mode: MigrationPushMode;
  wouldApply: number;
  wouldSkip: number;
  conflicts: number;
  appliedCount?: number;
  skippedCount?: number;
}): void {
  console.log();
  if (input.mode === "plan") {
    const parts = [
      `${String(input.wouldApply)} would apply`,
      `${String(input.wouldSkip)} already applied`,
    ];
    if (input.conflicts > 0) {
      parts.push(`${String(input.conflicts)} conflict${input.conflicts === 1 ? "" : "s"}`);
    }
    console.log(chalk.white(`Plan. ${parts.join(", ")}.`));
    return;
  }
  if (input.mode === "dry-run") {
    console.log(
      chalk.white(
        `Dry run OK. ${String(input.wouldApply)} would apply, ${String(input.wouldSkip)} already applied.`,
      ),
    );
    return;
  }
  console.log(
    chalk.white(
      `Done. ${String(input.appliedCount ?? 0)} applied, ${String(input.skippedCount ?? 0)} skipped.`,
    ),
  );
}

export function printSingleFilePushPreview(input: {
  filePath: string;
  slug: string;
  schemaHint: string;
  mode: MigrationPushMode;
}): void {
  const verb =
    input.mode === "apply" ? "Applying" : "Would apply";
  console.log(
    chalk.blue(
      `${verb} ${chalk.bold(input.filePath)} to project ${chalk.bold(input.slug)} (${chalk.dim(input.schemaHint)})`,
    ),
  );
  console.log(
    chalk.dim("  Single-file push (raw SQL, not recorded in flux.flux_migrations)."),
  );
  if (input.mode === "dry-run") {
    console.log(chalk.white("Dry run OK. Nothing applied."));
  }
}

export function printMigrationLedger(input: {
  slug: string;
  schemaHint: string;
  applied: readonly FluxMigrationRecord[];
}): void {
  console.log(
    chalk.dim(
      `Project ${chalk.bold(input.slug)} (${input.schemaHint})`,
    ),
  );
  console.log(chalk.dim(`Ledger: flux.flux_migrations (${String(input.applied.length)} applied)`));
  console.log();

  if (input.applied.length === 0) {
    console.log(chalk.dim("  (no migrations recorded yet)"));
    return;
  }

  const sorted = [...input.applied].sort((a, b) =>
    a.version.localeCompare(b.version),
  );
  for (const row of sorted) {
    const when = row.appliedAt?.trim() ? row.appliedAt : "—";
    const sum = row.checksum.slice(0, 12);
    console.log(
      `  ${chalk.white(row.version.padEnd(36))}${chalk.dim(when.padEnd(28))}${chalk.dim(sum)}…`,
    );
  }
}

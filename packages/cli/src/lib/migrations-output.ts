import {
  migrationConflictMessage,
  migrationPlanTimeline,
  type MigrationPlanResult,
} from "@flux/core/sql-migrations";
import {
  classifyMigrationSql,
  formatDdlSummaryLines,
} from "@flux/core/sql-ddl-classify";
import type { FluxMigrationRecord } from "@flux/core/sql-migrations";
import { basename } from "node:path";
import chalk from "chalk";
import { B } from "../cli-layout.js";
import type { PushScriptMode } from "./push-script-mode.js";

export const MIGRATION_EDIT_RULE =
  "Do not edit a migration after it has been applied. Create a new migration instead.";

export const MIGRATION_DDL_HEURISTIC_NOTE =
  "DDL summaries are heuristic — review SQL files for certainty.";

function printMigrationDdlSummary(content: string): void {
  const summary = classifyMigrationSql(content);
  for (const line of formatDdlSummaryLines(summary)) {
    const styled =
      line.startsWith("Warning:") || line.startsWith("- contains")
        ? chalk.yellow(`    ${line}`)
        : chalk.dim(`    ${line}`);
    console.log(styled);
  }
}

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

  if (isPreview && plan.apply.length > 0) {
    console.log(
      chalk.white(
        `Pending migrations: ${String(plan.apply.length)} ${chalk.dim(`(${MIGRATION_DDL_HEURISTIC_NOTE})`)}`,
      ),
    );
    console.log();
  }

  for (const entry of migrationPlanTimeline(plan)) {
    const { file, status } = entry;
    if (status === "skip") {
      console.log(
        chalk.green("✓"),
        chalk.white(`${file.filename} already applied`),
      );
      continue;
    }
    if (status === "conflict") {
      console.log(
        chalk.red("✗"),
        chalk.white(`${file.filename} checksum conflict`),
      );
      if (mode === "plan") {
        console.log(
          chalk.dim("  (run without --plan to see full details on failure)"),
        );
      }
      continue;
    }
    if (isPreview) {
      console.log(
        chalk.blue("→"),
        chalk.white(`${file.filename} would apply`),
      );
      printMigrationDdlSummary(file.content);
      console.log();
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
      `${String(input.wouldSkip)} in ledger`,
    ];
    if (input.conflicts > 0) {
      parts.push(`${String(input.conflicts)} conflict${input.conflicts === 1 ? "" : "s"}`);
    }
    console.log(chalk.white(`Plan. ${parts.join(", ")}.`));
    console.log(chalk.dim(`${B}Plan only — no SQL was executed against the database.`));
    if (input.wouldApply > 0 && input.wouldSkip === 0) {
      console.log(
        chalk.dim(
          `${B}Migration ledger is empty for this project; existing tables may be from raw/repeatable push or pre-ledger applies.`,
        ),
      );
    }
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

function ledgerUncheckedNote(mode: MigrationPushMode): string {
  return mode === "plan"
    ? "This plan did not check the ledger."
    : "This dry run did not check the ledger.";
}

/**
 * One-line description of what a later apply would record.
 * Preview never reads flux.flux_migrations or flux.flux_repeatable_scripts.
 */
function singleFilePushPreviewDetail(input: {
  filePath: string;
  mode: MigrationPushMode;
  scriptMode: PushScriptMode;
  scriptId?: string;
  checksum?: string;
}): string {
  if (input.scriptMode === "raw") {
    return "Single-file push (raw SQL, not recorded in flux.flux_migrations).";
  }
  const unchecked = ledgerUncheckedNote(input.mode);
  if (input.scriptMode === "versioned") {
    if (!input.checksum) {
      throw new Error("Versioned single-file preview requires a checksum.");
    }
    const version = basename(input.filePath);
    const prefix = input.checksum.slice(0, 12);
    return `Versioned migration: on apply, recorded in flux.flux_migrations as version ${version} (checksum ${prefix}). Skipped if already applied with the same checksum; fails on a checksum conflict. ${unchecked}`;
  }
  const scriptId = input.scriptId?.trim();
  if (!scriptId) {
    throw new Error("Repeatable single-file preview requires a script id.");
  }
  return `Repeatable script: on apply, recorded in flux.flux_repeatable_scripts under script id ${scriptId}. An unchanged checksum is skipped unless --force; a changed checksum is reapplied. ${unchecked}`;
}

export function printSingleFilePushPreview(input: {
  filePath: string;
  slug: string;
  schemaHint: string;
  mode: MigrationPushMode;
  scriptMode: PushScriptMode;
  scriptId?: string;
  checksum?: string;
}): void {
  const verb =
    input.mode === "apply" ? "Applying" : "Would apply";
  console.log(
    chalk.blue(
      `${verb} ${chalk.bold(input.filePath)} to project ${chalk.bold(input.slug)} (${chalk.dim(input.schemaHint)})`,
    ),
  );
  console.log(chalk.dim(`  ${singleFilePushPreviewDetail(input)}`));
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

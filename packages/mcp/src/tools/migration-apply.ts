/**
 * flux.migration.apply — controlled schema migration apply via a prior plan.
 *
 * Applies only files listed in a stored flux.migration.plan apply set.
 * Requires restore-verified backup trust (unless opted out) and explicit
 * allowDestructive for destructive-shaped plans.
 */

import { isAbsolute, join } from "node:path";
import { existsSync } from "node:fs";
import {
  classifyNewestBackup,
  type BackupTrustTier,
} from "@flux/core/backup-trust";
import type { BackupTrustInput } from "@flux/core/backup-trust";
import {
  listMigrationSqlFiles,
  loadLocalMigrations,
  planMigrations,
  type MigrationPushMeta,
} from "@flux/core/sql-migrations";
import type { PushSqlResult } from "@flux/cli/api-client";
import { getMigrationPlan, type StoredMigrationPlan } from "../plan-store";
import { computePlanHash } from "./migration-plan";
import { InvalidInputError, fail, ok, type ToolResult } from "../result";
import type { FluxToolClient } from "./index";

export type MigrationApplyGate =
  | "migration_apply_allowed"
  | "migration_apply_blocked_no_backup"
  | "migration_apply_blocked_stale_plan"
  | "migration_apply_blocked_destructive_requires_allow"
  | "migration_apply_failed";

/** Stable codes for plan drift / refusal before or during apply. */
export type MigrationApplyStaleReason =
  | "plan_not_found"
  | "plan_hash_mismatch"
  | "plan_file_missing"
  | "plan_file_checksum_mismatch"
  | "plan_conflicts_present"
  | "plan_apply_set_changed"
  | "plan_workspace_invalid"
  | "plan_migrations_path_invalid";

export interface MigrationApplyContext {
  intentId: string;
}

export interface MigrationApplySuccessData {
  planId: string;
  planHash: string;
  appliedCount: number;
  appliedFiles: string[];
  backupTrustTier: BackupTrustTier;
  destructiveShaped: boolean;
  intentId: string;
  gate: MigrationApplyGate;
}

export interface MigrationApplyFailureData {
  planId: string;
  planHash: string;
  appliedCount: number;
  appliedFiles: string[];
  backupTrustTier?: BackupTrustTier;
  destructiveShaped: boolean;
  intentId: string;
  gate: MigrationApplyGate;
  failedFile?: string;
  failureIndex?: number;
  remainingFiles?: string[];
  partialApply?: boolean;
  errorCode?: string;
}

export interface MigrationApplyStaleFailureData {
  planId: string;
  planHash?: string;
  appliedCount: 0;
  appliedFiles: [];
  destructiveShaped?: boolean;
  intentId?: string;
  gate: "migration_apply_blocked_stale_plan";
  staleReason: MigrationApplyStaleReason;
  expectedPlanHash?: string;
  actualPlanHash?: string;
  changedFiles?: string[];
  missingFiles?: string[];
  errorCode: "invalid_input";
}

export interface PlanValidationStaleDetails {
  staleReason: MigrationApplyStaleReason;
  planId: string;
  planHash?: string;
  expectedPlanHash?: string;
  actualPlanHash?: string;
  changedFiles?: string[];
  missingFiles?: string[];
  destructiveShaped?: boolean;
}

type MigrationApplyResultData =
  | MigrationApplySuccessData
  | MigrationApplyFailureData
  | MigrationApplyStaleFailureData;

/** Safe metadata for intent terminal updates and audit (no SQL, paths, or secrets). */
export function migrationApplyIntentMetadata(
  data: MigrationApplyResultData,
): Record<string, unknown> {
  if (data.gate === "migration_apply_blocked_stale_plan") {
    const stale = data as MigrationApplyStaleFailureData;
    const meta: Record<string, unknown> = {
      staleReason: stale.staleReason,
      gate: stale.gate,
      ...(stale.planHash !== undefined ? { planHash: stale.planHash } : {}),
      ...(stale.changedFiles !== undefined ? { changedFiles: stale.changedFiles } : {}),
      ...(stale.missingFiles !== undefined ? { missingFiles: stale.missingFiles } : {}),
      ...(stale.destructiveShaped !== undefined
        ? { destructiveShaped: stale.destructiveShaped }
        : {}),
    };
    return meta;
  }

  const base: Record<string, unknown> = {
    planHash: data.planHash,
    appliedCount: data.appliedCount,
    appliedFiles: data.appliedFiles,
    destructiveShaped: data.destructiveShaped,
    ...("backupTrustTier" in data && data.backupTrustTier !== undefined
      ? { backupTrustTier: data.backupTrustTier }
      : {}),
  };
  if (data.gate === "migration_apply_failed") {
    const failure = data as MigrationApplyFailureData;
    if (failure.failedFile !== undefined) {
      base.failedFile = failure.failedFile;
    }
    if (failure.failureIndex !== undefined) {
      base.failureIndex = failure.failureIndex;
    }
    if (failure.remainingFiles !== undefined) {
      base.remainingFiles = failure.remainingFiles;
    }
    if (failure.partialApply !== undefined) {
      base.partialApply = failure.partialApply;
    }
  }
  return base;
}

export function migrationApplyAuditMetadata(
  data: MigrationApplyResultData,
): Record<string, unknown> | undefined {
  if (data.gate === "migration_apply_failed" || data.gate === "migration_apply_blocked_stale_plan") {
    return migrationApplyIntentMetadata(data);
  }
  return undefined;
}

const LEDGER_HISTORY_NOTE =
  "Do not manually edit or delete migration ledger rows — they are real history.";

function plannedFilenames(stored: StoredMigrationPlan): string[] {
  return stored.apply.map((f) => f.filename);
}

function remainingPlannedFiles(stored: StoredMigrationPlan, failureIndex: number): string[] {
  return plannedFilenames(stored).slice(failureIndex + 1);
}

export function buildApplyLoopFailureSummary(input: {
  appliedCount: number;
  totalPlanned: number;
  failedFile: string;
  failureIndex: number;
}): string {
  const fileNum = input.failureIndex + 1;
  if (input.appliedCount > 0) {
    return (
      `Partial apply: ${String(input.appliedCount)} of ${String(input.totalPlanned)} ` +
      `migration(s) applied; failed on ${input.failedFile} (file ${String(fileNum)} of ${String(input.totalPlanned)}).`
    );
  }
  return (
    `Migration apply failed on ${input.failedFile} (file ${String(fileNum)} of ${String(input.totalPlanned)}); ` +
    "no migrations from this apply call were recorded."
  );
}

export function buildApplyLoopFailureRemediation(input: {
  appliedCount: number;
  failedFile: string;
  remainingFiles: string[];
}): string {
  if (input.appliedCount > 0) {
    const remaining =
      input.remainingFiles.length > 0
        ? ` Remaining planned files not attempted: ${input.remainingFiles.join(", ")}.`
        : "";
    return (
      "Some migrations from this plan may already be recorded in the project ledger. " +
      `${LEDGER_HISTORY_NOTE} Inspect the failed migration (${input.failedFile}), fix forward with a new migration or resolve the push error, then run flux.migration.plan before retrying flux.migration.apply.${remaining}`
    );
  }
  return (
    "No migrations from this MCP apply call were successfully recorded. " +
    `Inspect the failed migration (${input.failedFile}), fix the error, then run flux.migration.plan before retrying flux.migration.apply. ${LEDGER_HISTORY_NOTE}`
  );
}

function buildApplyLoopFailureResult(input: {
  planId: string;
  planHash: string;
  intentId: string;
  stored: StoredMigrationPlan;
  appliedFiles: string[];
  failedFile: string;
  failureIndex: number;
  errorCode: string;
  backupTrustTier?: BackupTrustTier;
}): ToolResult {
  const totalPlanned = input.stored.apply.length;
  const appliedCount = input.appliedFiles.length;
  const remainingFiles = remainingPlannedFiles(input.stored, input.failureIndex);
  const partialApply = appliedCount > 0;

  const data: MigrationApplyFailureData = {
    planId: input.planId,
    planHash: input.planHash,
    appliedCount,
    appliedFiles: [...input.appliedFiles],
    destructiveShaped: input.stored.destructiveShaped,
    intentId: input.intentId,
    gate: "migration_apply_failed",
    failedFile: input.failedFile,
    failureIndex: input.failureIndex,
    remainingFiles,
    partialApply,
    errorCode: input.errorCode,
    ...(input.backupTrustTier !== undefined ? { backupTrustTier: input.backupTrustTier } : {}),
  };

  return fail(
    buildApplyLoopFailureSummary({
      appliedCount,
      totalPlanned,
      failedFile: input.failedFile,
      failureIndex: input.failureIndex,
    }),
    {
      data,
      remediation: buildApplyLoopFailureRemediation({
        appliedCount,
        failedFile: input.failedFile,
        remainingFiles,
      }),
    },
  );
}

const MAX_SQL_BYTES = 4 * 1024 * 1024;

export function stalePlanRemediation(reason: MigrationApplyStaleReason): string {
  switch (reason) {
    case "plan_not_found":
      return "Plan not found or MCP server restarted. Re-run flux.migration.plan.";
    case "plan_hash_mismatch":
      return "The supplied planHash does not match the stored plan. Re-run flux.migration.plan and apply the new plan.";
    case "plan_file_missing":
      return "A planned migration file is missing locally. Restore the file or re-run flux.migration.plan from the current workspace.";
    case "plan_file_checksum_mismatch":
      return "A migration file changed after planning. Re-run flux.migration.plan before applying.";
    case "plan_conflicts_present":
      return "The plan contains conflicts and cannot be applied. Resolve migration conflicts, then re-run flux.migration.plan.";
    case "plan_apply_set_changed":
      return "The planned apply set no longer matches local or ledger state. Re-run flux.migration.plan before applying.";
    case "plan_workspace_invalid":
      return "Workspace root is invalid or not a Flux-linked project. Fix workspaceRoot or run from a linked repo, then re-run flux.migration.plan.";
    case "plan_migrations_path_invalid":
      return "migrationsPath is missing or invalid. Fix migrationsPath, then re-run flux.migration.plan.";
  }
}

export function stalePlanSummary(
  reason: MigrationApplyStaleReason,
  details?: Pick<PlanValidationStaleDetails, "changedFiles" | "missingFiles">,
): string {
  switch (reason) {
    case "plan_not_found":
      return "Migration plan not found.";
    case "plan_hash_mismatch":
      return "Submitted planHash does not match stored plan.";
    case "plan_file_missing": {
      const file = details?.missingFiles?.[0];
      return file
        ? `Planned migration file missing locally: ${file}.`
        : "A planned migration file is missing locally.";
    }
    case "plan_file_checksum_mismatch": {
      const file = details?.changedFiles?.[0];
      return file
        ? `Local migration changed since planning: ${file}.`
        : "A local migration file changed since planning.";
    }
    case "plan_conflicts_present":
      return "Plan has checksum conflicts; cannot apply.";
    case "plan_apply_set_changed":
      return "Planned apply set no longer matches local or ledger state.";
    case "plan_workspace_invalid":
      return "Workspace root is invalid or not Flux-linked.";
    case "plan_migrations_path_invalid":
      return "migrationsPath does not exist or is unreadable.";
  }
}

export function buildStalePlanFailureData(input: {
  stale: PlanValidationStaleDetails;
  intentId?: string;
}): MigrationApplyStaleFailureData {
  return {
    planId: input.stale.planId,
    ...(input.stale.planHash !== undefined ? { planHash: input.stale.planHash } : {}),
    appliedCount: 0,
    appliedFiles: [],
    gate: "migration_apply_blocked_stale_plan",
    staleReason: input.stale.staleReason,
    errorCode: "invalid_input",
    ...(input.intentId !== undefined ? { intentId: input.intentId } : {}),
    ...(input.stale.expectedPlanHash !== undefined
      ? { expectedPlanHash: input.stale.expectedPlanHash }
      : {}),
    ...(input.stale.actualPlanHash !== undefined ? { actualPlanHash: input.stale.actualPlanHash } : {}),
    ...(input.stale.changedFiles !== undefined ? { changedFiles: input.stale.changedFiles } : {}),
    ...(input.stale.missingFiles !== undefined ? { missingFiles: input.stale.missingFiles } : {}),
    ...(input.stale.destructiveShaped !== undefined
      ? { destructiveShaped: input.stale.destructiveShaped }
      : {}),
  };
}

export function buildStalePlanToolResult(input: {
  stale: PlanValidationStaleDetails;
  intentId?: string;
}): ToolResult {
  const data = buildStalePlanFailureData(input);
  return fail(stalePlanSummary(input.stale.staleReason, input.stale), {
    data,
    remediation: stalePlanRemediation(input.stale.staleReason),
  });
}

function staleValidationFailure(stale: PlanValidationStaleDetails): PlanValidationResult {
  return {
    ok: false,
    gate: "migration_apply_blocked_stale_plan",
    summary: stalePlanSummary(stale.staleReason, stale),
    remediation: stalePlanRemediation(stale.staleReason),
    stale,
  };
}

function requireHash(args: Record<string, unknown>): string {
  const hash = args.hash;
  if (typeof hash !== "string" || !/^[a-f0-9]{7}$/u.test(hash.trim().toLowerCase())) {
    throw new InvalidInputError("hash must be a 7-char hex project id.");
  }
  return hash.trim().toLowerCase();
}

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || !v.trim()) {
    throw new InvalidInputError(`${key} is required.`);
  }
  return v.trim();
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const v = args[key];
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") {
    throw new InvalidInputError(`${key} must be a boolean when provided.`);
  }
  return v;
}

function resolveWorkspaceRoot(workspaceRoot: string | undefined): string {
  const explicit = workspaceRoot?.trim();
  if (explicit) return explicit;
  const cwd = process.cwd();
  if (existsSync(join(cwd, "flux.json"))) return cwd;
  throw new InvalidInputError(
    "workspaceRoot is required: process.cwd() is not a Flux-linked project (no flux.json).",
  );
}

function resolveMigrationsDir(root: string, migrationsPath: string): string {
  const p = migrationsPath.trim();
  if (!p) throw new InvalidInputError("migrationsPath is required.");
  return isAbsolute(p) ? p : join(root, p);
}

export function migrationApplyAuditGate(result: ToolResult): MigrationApplyGate {
  if (result.ok) return "migration_apply_allowed";
  const data = result.data as { gate?: MigrationApplyGate } | null;
  if (data?.gate) return data.gate;
  return "migration_apply_failed";
}

export type PlanValidationResult =
  | { ok: true; stored: StoredMigrationPlan; migrationsDir: string }
  | {
      ok: false;
      gate: "migration_apply_blocked_stale_plan";
      summary: string;
      remediation: string;
      stale: PlanValidationStaleDetails;
    };

/** Local plan validation (no migration push API). Safe before intent creation. */
export async function validateStoredPlanForApply(input: {
  hash: string;
  planId: string;
  planHash: string;
  workspaceRoot?: string;
  migrationsPath: string;
}): Promise<PlanValidationResult> {
  const planId = input.planId.trim();
  const submittedPlanHash = input.planHash.trim();
  const hash = input.hash.trim().toLowerCase();

  const stored = getMigrationPlan(planId);
  if (!stored) {
    return staleValidationFailure({
      staleReason: "plan_not_found",
      planId,
      planHash: submittedPlanHash,
    });
  }

  if (stored.hash !== hash) {
    return staleValidationFailure({
      staleReason: "plan_workspace_invalid",
      planId,
      planHash: submittedPlanHash,
      destructiveShaped: stored.destructiveShaped,
    });
  }

  if (stored.planHash !== submittedPlanHash) {
    return staleValidationFailure({
      staleReason: "plan_hash_mismatch",
      planId,
      planHash: submittedPlanHash,
      expectedPlanHash: stored.planHash,
      actualPlanHash: submittedPlanHash,
      destructiveShaped: stored.destructiveShaped,
    });
  }

  if (stored.conflicts.length > 0) {
    return staleValidationFailure({
      staleReason: "plan_conflicts_present",
      planId,
      planHash: submittedPlanHash,
      destructiveShaped: stored.destructiveShaped,
    });
  }

  if (stored.apply.length === 0) {
    return staleValidationFailure({
      staleReason: "plan_apply_set_changed",
      planId,
      planHash: submittedPlanHash,
      destructiveShaped: stored.destructiveShaped,
    });
  }

  let migrationsDir: string;
  try {
    const workspaceRoot = resolveWorkspaceRoot(input.workspaceRoot);
    migrationsDir = resolveMigrationsDir(workspaceRoot, input.migrationsPath);
  } catch {
    return staleValidationFailure({
      staleReason: "plan_workspace_invalid",
      planId,
      planHash: submittedPlanHash,
      destructiveShaped: stored.destructiveShaped,
    });
  }

  if (!existsSync(migrationsDir)) {
    return staleValidationFailure({
      staleReason: "plan_migrations_path_invalid",
      planId,
      planHash: submittedPlanHash,
      destructiveShaped: stored.destructiveShaped,
    });
  }

  let paths: string[];
  try {
    paths = await listMigrationSqlFiles(migrationsDir);
  } catch {
    return staleValidationFailure({
      staleReason: "plan_migrations_path_invalid",
      planId,
      planHash: submittedPlanHash,
      destructiveShaped: stored.destructiveShaped,
    });
  }

  const local = await loadLocalMigrations(paths);
  const localByFilename = new Map(local.map((f) => [f.filename, f]));

  for (const file of stored.apply) {
    const current = localByFilename.get(file.filename);
    if (!current) {
      return staleValidationFailure({
        staleReason: "plan_file_missing",
        planId,
        planHash: submittedPlanHash,
        missingFiles: [file.filename],
        destructiveShaped: stored.destructiveShaped,
      });
    }
    if (current.checksum !== file.checksum) {
      return staleValidationFailure({
        staleReason: "plan_file_checksum_mismatch",
        planId,
        planHash: submittedPlanHash,
        changedFiles: [file.filename],
        destructiveShaped: stored.destructiveShaped,
      });
    }
  }

  return { ok: true, stored, migrationsDir };
}

async function verifyPlanStillCurrent(input: {
  client: FluxToolClient;
  hash: string;
  planId: string;
  planHash: string;
  stored: StoredMigrationPlan;
  migrationsDir: string;
}): Promise<PlanValidationResult | { ok: true }> {
  const paths = await listMigrationSqlFiles(input.migrationsDir);
  const local = await loadLocalMigrations(paths);
  const applied = await input.client.listAppliedMigrations(input.hash);
  const plan = planMigrations(local, applied);

  if (plan.conflicts.length > 0) {
    return staleValidationFailure({
      staleReason: "plan_conflicts_present",
      planId: input.planId,
      planHash: input.planHash,
      destructiveShaped: input.stored.destructiveShaped,
    });
  }

  const freshHash = computePlanHash(plan);
  if (freshHash !== input.planHash || freshHash !== input.stored.planHash) {
    return staleValidationFailure({
      staleReason: "plan_apply_set_changed",
      planId: input.planId,
      planHash: input.planHash,
      expectedPlanHash: input.stored.planHash,
      actualPlanHash: freshHash,
      destructiveShaped: input.stored.destructiveShaped,
    });
  }

  for (let i = 0; i < input.stored.apply.length; i += 1) {
    const planned = plan.apply[i];
    const storedFile = input.stored.apply[i]!;
    if (
      !planned ||
      planned.filename !== storedFile.filename ||
      planned.checksum !== storedFile.checksum
    ) {
      return staleValidationFailure({
        staleReason: "plan_apply_set_changed",
        planId: input.planId,
        planHash: input.planHash,
        changedFiles: [storedFile.filename],
        destructiveShaped: input.stored.destructiveShaped,
      });
    }
  }

  return { ok: true };
}

async function resolveBackupTrustTier(
  client: FluxToolClient,
  hash: string,
): Promise<BackupTrustTier> {
  const { backups } = await client.listProjectBackups(hash);
  return classifyNewestBackup(backups as unknown as BackupTrustInput[]).tier;
}

function failureData(
  base: Omit<MigrationApplyFailureData, "gate"> & { gate: MigrationApplyGate },
): MigrationApplyFailureData {
  return base;
}

export async function runMigrationApply(
  client: FluxToolClient,
  args: Record<string, unknown>,
  ctx: MigrationApplyContext,
  stored: StoredMigrationPlan,
  migrationsDir: string,
): Promise<ToolResult> {
  const hash = requireHash(args);
  const planId = requireString(args, "planId");
  const planHash = requireString(args, "planHash");
  const requireVerifiedBackup = optionalBoolean(args, "requireVerifiedBackup") ?? true;
  const allowDestructive = optionalBoolean(args, "allowDestructive") ?? false;

  const driftCheck = await verifyPlanStillCurrent({
    client,
    hash,
    planId,
    planHash,
    stored,
    migrationsDir,
  });
  if (!driftCheck.ok) {
    return buildStalePlanToolResult({
      stale: driftCheck.stale,
      intentId: ctx.intentId,
    });
  }

  let backupTrustTier: BackupTrustTier | undefined;

  if (requireVerifiedBackup) {
    const { backups } = await client.listProjectBackups(hash);
    const classification = classifyNewestBackup(backups as unknown as BackupTrustInput[]);
    backupTrustTier = classification.tier;
    if (!classification.allowsDestructiveWithoutOverride) {
      return fail("Restore-verified backup required before migration apply.", {
        data: failureData({
          planId,
          planHash,
          appliedCount: 0,
          appliedFiles: [],
          destructiveShaped: stored.destructiveShaped,
          intentId: ctx.intentId,
          gate: "migration_apply_blocked_no_backup",
          backupTrustTier,
          errorCode: "invalid_input",
        }),
        remediation: "Run flux.backup.ensureVerified first.",
      });
    }
  }

  if (stored.destructiveShaped && !allowDestructive) {
    return fail("Destructive-shaped migration plan requires allowDestructive: true.", {
      data: failureData({
        planId,
        planHash,
        appliedCount: 0,
        appliedFiles: [],
        destructiveShaped: true,
        intentId: ctx.intentId,
        gate: "migration_apply_blocked_destructive_requires_allow",
        ...(backupTrustTier !== undefined ? { backupTrustTier } : {}),
        errorCode: "invalid_input",
      }),
      remediation:
        "Re-run with allowDestructive: true only after reviewing plan warnings and ensuring a restore-verified backup.",
    });
  }

  const slugArg = typeof args.slug === "string" ? args.slug.trim() : "";
  const metadata = await client.getProjectMetadata(hash);
  const slug = slugArg || metadata.slug;

  const paths = await listMigrationSqlFiles(migrationsDir);
  const local = await loadLocalMigrations(paths);
  const localByFilename = new Map(local.map((f) => [f.filename, f]));

  const appliedFiles: string[] = [];
  const totalPlanned = stored.apply.length;

  for (let failureIndex = 0; failureIndex < totalPlanned; failureIndex += 1) {
    const file = stored.apply[failureIndex]!;
    const localFile = localByFilename.get(file.filename);
    if (!localFile) {
      return buildApplyLoopFailureResult({
        planId,
        planHash,
        intentId: ctx.intentId,
        stored,
        appliedFiles,
        failedFile: file.filename,
        failureIndex,
        errorCode: "invalid_input",
        ...(backupTrustTier !== undefined ? { backupTrustTier } : {}),
      });
    }

    if (Buffer.byteLength(localFile.content, "utf8") > MAX_SQL_BYTES) {
      return buildApplyLoopFailureResult({
        planId,
        planHash,
        intentId: ctx.intentId,
        stored,
        appliedFiles,
        failedFile: file.filename,
        failureIndex,
        errorCode: "invalid_input",
        ...(backupTrustTier !== undefined ? { backupTrustTier } : {}),
      });
    }

    const migration: MigrationPushMeta = {
      version: file.version,
      filename: file.filename,
      checksum: file.checksum,
    };

    try {
      const result: PushSqlResult = await client.pushSql({
        slug,
        hash,
        sql: localFile.content,
        migration,
      });
      if (result.skipped !== true) {
        appliedFiles.push(file.filename);
      } else if (!appliedFiles.includes(file.filename)) {
        appliedFiles.push(file.filename);
      }
    } catch {
      return buildApplyLoopFailureResult({
        planId,
        planHash,
        intentId: ctx.intentId,
        stored,
        appliedFiles,
        failedFile: file.filename,
        failureIndex,
        errorCode: "upstream_error",
        ...(backupTrustTier !== undefined ? { backupTrustTier } : {}),
      });
    }
  }

  if (backupTrustTier === undefined && requireVerifiedBackup) {
    backupTrustTier = await resolveBackupTrustTier(client, hash);
  }

  const success: MigrationApplySuccessData = {
    planId,
    planHash,
    appliedCount: appliedFiles.length,
    appliedFiles,
    backupTrustTier: backupTrustTier ?? "no_backups",
    destructiveShaped: stored.destructiveShaped,
    intentId: ctx.intentId,
    gate: "migration_apply_allowed",
  };

  return ok(
    `Applied ${String(appliedFiles.length)} migration file(s) from plan ${planHash.slice(0, 12)}.`,
    success,
  );
}

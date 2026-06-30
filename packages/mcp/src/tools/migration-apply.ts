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
  errorCode?: string;
}

const PLAN_MISSING_MSG =
  "Plan not found or MCP server restarted. Re-run flux.migration.plan.";
const MAX_SQL_BYTES = 4 * 1024 * 1024;

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
  | { ok: false; gate: MigrationApplyGate; summary: string; remediation: string };

/** Local plan validation (no migration push API). Safe before intent creation. */
export async function validateStoredPlanForApply(input: {
  hash: string;
  planId: string;
  planHash: string;
  workspaceRoot?: string;
  migrationsPath: string;
}): Promise<PlanValidationResult> {
  const stored = getMigrationPlan(input.planId);
  if (!stored) {
    return {
      ok: false,
      gate: "migration_apply_blocked_stale_plan",
      summary: "Migration plan not found.",
      remediation: PLAN_MISSING_MSG,
    };
  }

  if (stored.hash !== input.hash.trim().toLowerCase()) {
    return {
      ok: false,
      gate: "migration_apply_blocked_stale_plan",
      summary: "Plan project hash does not match.",
      remediation: PLAN_MISSING_MSG,
    };
  }

  if (stored.planHash !== input.planHash.trim()) {
    return {
      ok: false,
      gate: "migration_apply_blocked_stale_plan",
      summary: "Submitted planHash does not match stored plan.",
      remediation: "Re-run flux.migration.plan and apply with the new planId/planHash.",
    };
  }

  if (stored.conflicts.length > 0) {
    return {
      ok: false,
      gate: "migration_apply_blocked_stale_plan",
      summary: "Plan has checksum conflicts; cannot apply.",
      remediation:
        "Resolve migration conflicts (create a new migration instead of editing applied files), then re-plan.",
    };
  }

  if (stored.apply.length === 0) {
    return {
      ok: false,
      gate: "migration_apply_blocked_stale_plan",
      summary: "Plan has no migrations to apply.",
      remediation: "Re-run flux.migration.plan when new migration files are ready.",
    };
  }

  let migrationsDir: string;
  try {
    const workspaceRoot = resolveWorkspaceRoot(input.workspaceRoot);
    migrationsDir = resolveMigrationsDir(workspaceRoot, input.migrationsPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      gate: "migration_apply_blocked_stale_plan",
      summary: msg,
      remediation: PLAN_MISSING_MSG,
    };
  }

  if (!existsSync(migrationsDir)) {
    return {
      ok: false,
      gate: "migration_apply_blocked_stale_plan",
      summary: "migrationsPath does not exist.",
      remediation: PLAN_MISSING_MSG,
    };
  }

  let paths: string[];
  try {
    paths = await listMigrationSqlFiles(migrationsDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      gate: "migration_apply_blocked_stale_plan",
      summary: msg,
      remediation: PLAN_MISSING_MSG,
    };
  }

  const local = await loadLocalMigrations(paths);
  const localByFilename = new Map(local.map((f) => [f.filename, f]));

  for (const file of stored.apply) {
    const current = localByFilename.get(file.filename);
    if (!current || current.checksum !== file.checksum) {
      return {
        ok: false,
        gate: "migration_apply_blocked_stale_plan",
        summary: `Local migration drift detected for ${file.filename}.`,
        remediation:
          "Local migration files changed since planning. Re-run flux.migration.plan before apply.",
      };
    }
  }

  return { ok: true, stored, migrationsDir };
}

async function verifyPlanStillCurrent(input: {
  client: FluxToolClient;
  hash: string;
  planHash: string;
  stored: StoredMigrationPlan;
  migrationsDir: string;
}): Promise<PlanValidationResult | { ok: true }> {
  const paths = await listMigrationSqlFiles(input.migrationsDir);
  const local = await loadLocalMigrations(paths);
  const applied = await input.client.listAppliedMigrations(input.hash);
  const plan = planMigrations(local, applied);

  if (plan.conflicts.length > 0) {
    return {
      ok: false,
      gate: "migration_apply_blocked_stale_plan",
      summary: "Applied ledger conflicts with local migrations.",
      remediation:
        "Resolve migration conflicts, then re-run flux.migration.plan before apply.",
    };
  }

  const freshHash = computePlanHash(plan);
  if (freshHash !== input.planHash || freshHash !== input.stored.planHash) {
    return {
      ok: false,
      gate: "migration_apply_blocked_stale_plan",
      summary: "Local migration state drifted since planning.",
      remediation:
        "Local migration files or ledger changed since planning. Re-run flux.migration.plan before apply.",
    };
  }

  for (let i = 0; i < input.stored.apply.length; i += 1) {
    const planned = plan.apply[i];
    const storedFile = input.stored.apply[i]!;
    if (
      !planned ||
      planned.filename !== storedFile.filename ||
      planned.checksum !== storedFile.checksum
    ) {
      return {
        ok: false,
        gate: "migration_apply_blocked_stale_plan",
        summary: "Planned apply set no longer matches stored plan.",
        remediation:
          "Local migration files changed since planning. Re-run flux.migration.plan before apply.",
      };
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
    planHash,
    stored,
    migrationsDir,
  });
  if (!driftCheck.ok) {
    return fail(driftCheck.summary, {
      data: failureData({
        planId,
        planHash,
        appliedCount: 0,
        appliedFiles: [],
        destructiveShaped: stored.destructiveShaped,
        intentId: ctx.intentId,
        gate: driftCheck.gate,
        errorCode: "invalid_input",
      }),
      remediation: driftCheck.remediation,
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

  for (const file of stored.apply) {
    const localFile = localByFilename.get(file.filename);
    if (!localFile) {
      return fail(`Migration file missing locally: ${file.filename}`, {
        data: failureData({
          planId,
          planHash,
          appliedCount: appliedFiles.length,
          appliedFiles,
          destructiveShaped: stored.destructiveShaped,
          intentId: ctx.intentId,
          gate: "migration_apply_failed",
          failedFile: file.filename,
          errorCode: "invalid_input",
          ...(backupTrustTier !== undefined ? { backupTrustTier } : {}),
        }),
        remediation: PLAN_MISSING_MSG,
      });
    }

    if (Buffer.byteLength(localFile.content, "utf8") > MAX_SQL_BYTES) {
      return fail(`${file.filename} exceeds 4 MiB push limit.`, {
        data: failureData({
          planId,
          planHash,
          appliedCount: appliedFiles.length,
          appliedFiles,
          destructiveShaped: stored.destructiveShaped,
          intentId: ctx.intentId,
          gate: "migration_apply_failed",
          failedFile: file.filename,
          errorCode: "invalid_input",
          ...(backupTrustTier !== undefined ? { backupTrustTier } : {}),
        }),
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(`Migration apply failed on ${file.filename}: ${msg}`, {
        data: failureData({
          planId,
          planHash,
          appliedCount: appliedFiles.length,
          appliedFiles,
          destructiveShaped: stored.destructiveShaped,
          intentId: ctx.intentId,
          gate: "migration_apply_failed",
          failedFile: file.filename,
          errorCode: "upstream_error",
          ...(backupTrustTier !== undefined ? { backupTrustTier } : {}),
        }),
        remediation:
          appliedFiles.length > 0
            ? "Earlier files were applied; fix the failed migration and create a new plan before retrying."
            : "Fix the migration error and re-run flux.migration.plan before apply.",
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

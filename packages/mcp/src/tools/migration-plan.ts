/**
 * Migration planning for `flux.migration.plan`.
 *
 * Reuses the shared `@flux/core` migration primitives (no duplicated planning
 * logic): local files are loaded + checksummed exactly as `flux push` does, and
 * compared against the applied ledger fetched via the CLI API client. This pass
 * only plans — it never applies and never writes to the database.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  listMigrationSqlFiles,
  loadLocalMigrations,
  planMigrations,
  type FluxMigrationRecord,
  type LocalMigrationFile,
} from "@flux/core/sql-migrations";
import { classifyMigrationSql } from "@flux/core/sql-ddl-classify";
import { InvalidInputError } from "../result";
import {
  storeMigrationPlan,
  type StoredMigrationFile,
} from "../plan-store";

export interface MigrationPlanInput {
  hash: string;
  slug?: string;
  workspaceRoot?: string;
  migrationsPath?: string;
}

export interface MigrationPlanData {
  planId: string;
  planHash: string;
  hash: string;
  slug?: string;
  workspaceRoot: string;
  migrationsDir: string;
  apply: StoredMigrationFile[];
  skip: StoredMigrationFile[];
  conflicts: Array<StoredMigrationFile & { appliedChecksum: string }>;
  warnings: string[];
  destructiveShaped: boolean;
  counts: { apply: number; skip: number; conflicts: number };
}

/** Loader for applied ledger rows (injectable for tests). */
export type AppliedMigrationsLoader = (
  hash: string,
) => Promise<FluxMigrationRecord[]>;

function resolveWorkspaceRoot(workspaceRoot: string | undefined): string {
  const explicit = workspaceRoot?.trim();
  if (explicit) return explicit;
  const cwd = process.cwd();
  // Only fall back to cwd when it is clearly a Flux-linked project.
  if (existsSync(join(cwd, "flux.json"))) return cwd;
  throw new InvalidInputError(
    "workspaceRoot is required: process.cwd() is not a Flux-linked project (no flux.json).",
  );
}

function resolveMigrationsDir(root: string, migrationsPath: string | undefined): string {
  const p = migrationsPath?.trim();
  if (!p) {
    throw new InvalidInputError("migrationsPath is required.");
  }
  return isAbsolute(p) ? p : join(root, p);
}

function toStoredFile(file: LocalMigrationFile): StoredMigrationFile {
  return {
    version: file.version,
    filename: file.filename,
    checksum: file.checksum,
  };
}

/**
 * Stable hash of the plan: derived only from versions + checksums (and applied
 * checksums for conflicts), so identical inputs always produce the same value
 * regardless of when the plan was generated.
 */
export function computePlanHash(input: {
  apply: LocalMigrationFile[];
  skip: LocalMigrationFile[];
  conflicts: Array<{ file: LocalMigrationFile; appliedChecksum: string }>;
}): string {
  const canonical = JSON.stringify({
    apply: input.apply.map((f) => [f.version, f.checksum]),
    skip: input.skip.map((f) => [f.version, f.checksum]),
    conflicts: input.conflicts.map((c) => [
      c.file.version,
      c.file.checksum,
      c.appliedChecksum,
    ]),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export async function buildMigrationPlan(
  input: MigrationPlanInput,
  loadApplied: AppliedMigrationsLoader,
): Promise<MigrationPlanData> {
  const hash = input.hash.trim();
  if (!hash) {
    throw new InvalidInputError("Missing required string argument: hash");
  }

  const workspaceRoot = resolveWorkspaceRoot(input.workspaceRoot);
  const migrationsDir = resolveMigrationsDir(workspaceRoot, input.migrationsPath);
  if (!existsSync(migrationsDir)) {
    throw new InvalidInputError(`migrationsPath does not exist: ${migrationsDir}`);
  }

  // listMigrationSqlFiles throws a clear error for empty/unreadable dirs.
  const paths = await listMigrationSqlFiles(migrationsDir);
  const local = await loadLocalMigrations(paths);
  const applied = await loadApplied(hash);
  const plan = planMigrations(local, applied);

  const warnings: string[] = [];
  let destructiveShaped = false;
  for (const file of plan.apply) {
    const summary = classifyMigrationSql(file.content);
    if (summary.hasDestructive) {
      destructiveShaped = true;
      for (const w of summary.warnings) {
        warnings.push(`${file.filename}: ${w}`);
      }
    }
  }

  const planHash = computePlanHash(plan);
  const planId = randomUUID();

  const apply = plan.apply.map(toStoredFile);
  const skip = plan.skip.map(toStoredFile);
  const conflicts = plan.conflicts.map((c) => ({
    ...toStoredFile(c.file),
    appliedChecksum: c.appliedChecksum,
  }));

  storeMigrationPlan({
    planId,
    planHash,
    hash,
    ...(input.slug ? { slug: input.slug } : {}),
    migrationsDir,
    createdAt: new Date().toISOString(),
    apply,
    skip,
    conflicts,
    destructiveShaped,
  });

  return {
    planId,
    planHash,
    hash,
    ...(input.slug ? { slug: input.slug } : {}),
    workspaceRoot,
    migrationsDir,
    apply,
    skip,
    conflicts,
    warnings,
    destructiveShaped,
    counts: {
      apply: apply.length,
      skip: skip.length,
      conflicts: conflicts.length,
    },
  };
}

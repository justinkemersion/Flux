import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Ledger DDL — lives in `flux` schema (not exposed via PostgREST tenant db-schemas). */
export const FLUX_MIGRATIONS_DDL = `
CREATE SCHEMA IF NOT EXISTS flux;
CREATE TABLE IF NOT EXISTS flux.flux_migrations (
  version text PRIMARY KEY,
  filename text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
`.trim();

export type FluxMigrationRecord = {
  version: string;
  filename: string;
  checksum: string;
  appliedAt?: string;
};

export type LocalMigrationFile = {
  version: string;
  filename: string;
  path: string;
  checksum: string;
  content: string;
};

export type MigrationPushMeta = {
  version: string;
  filename: string;
  checksum: string;
};

export type MigrationPlanResult = {
  skip: LocalMigrationFile[];
  apply: LocalMigrationFile[];
  conflicts: Array<{
    file: LocalMigrationFile;
    appliedChecksum: string;
  }>;
};

/** SHA-256 hex digest of migration file content (UTF-8). */
export function migrationChecksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Escape a value for use inside a Postgres single-quoted string literal. */
export function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Lists top-level `*.sql` files in a directory, sorted lexicographically by basename.
 */
export async function listMigrationSqlFiles(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read migrations directory ${dir}: ${msg}`);
  }
  const sqlFiles = entries.filter((name) => name.endsWith(".sql")).sort();
  if (sqlFiles.length === 0) {
    throw new Error(`No .sql files found in ${dir}`);
  }
  return sqlFiles.map((name) => join(dir, name));
}

/**
 * Loads migration files from paths with checksums. `version` = basename.
 */
export async function loadLocalMigrations(
  paths: string[],
): Promise<LocalMigrationFile[]> {
  const out: LocalMigrationFile[] = [];
  for (const path of paths) {
    const content = await readFile(path, "utf8");
    const filename = path.split("/").pop() ?? path;
    const version = filename;
    out.push({
      version,
      filename,
      path,
      content,
      checksum: migrationChecksum(content),
    });
  }
  return out;
}

/**
 * Compares local migration files against applied ledger rows.
 */
export function planMigrations(
  local: LocalMigrationFile[],
  applied: readonly FluxMigrationRecord[],
): MigrationPlanResult {
  const byVersion = new Map(applied.map((r) => [r.version, r]));
  const skip: LocalMigrationFile[] = [];
  const apply: LocalMigrationFile[] = [];
  const conflicts: MigrationPlanResult["conflicts"] = [];

  for (const file of local) {
    const row = byVersion.get(file.version);
    if (!row) {
      apply.push(file);
      continue;
    }
    if (row.checksum === file.checksum) {
      skip.push(file);
      continue;
    }
    conflicts.push({ file, appliedChecksum: row.checksum });
  }

  return { skip, apply, conflicts };
}

export type MigrationLedgerAction = "skip" | "apply" | "conflict";

/**
 * Decides whether to skip, apply, or reject a migration push given a ledger row (if any).
 */
export function resolveMigrationLedgerAction(
  existing: Pick<FluxMigrationRecord, "checksum"> | undefined,
  migration: MigrationPushMeta,
): MigrationLedgerAction {
  if (!existing) return "apply";
  if (existing.checksum === migration.checksum) return "skip";
  return "conflict";
}

/** SQL to list applied migrations (table may not exist yet). */
export const LIST_FLUX_MIGRATIONS_SQL = `
SELECT version, filename, checksum, applied_at AS "appliedAt"
FROM flux.flux_migrations
ORDER BY version ASC;
`.trim();

/**
 * Wraps user SQL for a migration-mode push: ensure ledger, run user SQL, insert row.
 * Caller must run {@link resolveMigrationLedgerAction} first (separate query) to skip or conflict.
 */
export function buildMigrationPushSql(input: {
  userSql: string;
  migration: MigrationPushMeta;
}): string {
  const { userSql, migration } = input;
  const v = sqlLiteral(migration.version);
  const f = sqlLiteral(migration.filename);
  const c = sqlLiteral(migration.checksum);

  const insert = `
INSERT INTO flux.flux_migrations (version, filename, checksum)
VALUES (${v}, ${f}, ${c});`.trim();

  return [FLUX_MIGRATIONS_DDL, userSql.trim(), insert]
    .filter((s) => s.length > 0)
    .join("\n\n");
}

/** Parameterized lookup for ledger row by version (server uses with bound params). */
export const SELECT_MIGRATION_CHECKSUM_SQL = `
SELECT checksum FROM flux.flux_migrations WHERE version = $1 LIMIT 1;
`.trim();

export function migrationConflictMessage(
  migration: MigrationPushMeta,
  appliedChecksum: string,
): string {
  const name = migration.filename || migration.version;
  return [
    "Migration checksum conflict",
    "",
    `${name} was already applied, but its contents changed.`,
    "",
    `Applied checksum: ${appliedChecksum}`,
    `Current checksum: ${migration.checksum}`,
    "",
    "Create a new migration instead of editing an applied migration.",
  ].join("\n");
}

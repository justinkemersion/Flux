import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { sanitizePlainSqlDumpForPostgresMajor } from "./import-dump.ts";

/** Shared pool / push sanitization target (PG16-compatible). */
export const FLUX_PUSH_SQL_TARGET_MAJOR = 16;

/**
 * Normalizes migration/push SQL before checksum and execution (strips PG17+ session
 * lines, psql meta-commands, etc.). Idempotent for already-normalized content.
 */
export function normalizePushSql(
  sql: string,
  targetMajor: number = FLUX_PUSH_SQL_TARGET_MAJOR,
): string {
  return sanitizePlainSqlDumpForPostgresMajor(sql, targetMajor);
}

/** Ledger DDL — lives in `flux` schema (not exposed via PostgREST tenant db-schemas). */
export const FLUX_MIGRATIONS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS flux.flux_migrations (
  tenant_schema text NOT NULL,
  version text NOT NULL,
  filename text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_schema, version)
);
`.trim();

/**
 * Idempotent ledger ensure for pooled (multi-tenant) clusters. Fails closed when a
 * legacy global ledger (version-only PK) already has rows — operator must migrate manually.
 */
export function buildFluxMigrationsLedgerEnsureSql(tenantSchema: string): string {
  const ts = sqlLiteral(tenantSchema);
  return `
CREATE SCHEMA IF NOT EXISTS flux;
DO $$
DECLARE
  legacy_without_tenant boolean;
  row_count bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'flux' AND table_name = 'flux_migrations'
  ) THEN
    ${FLUX_MIGRATIONS_TABLE_DDL};
    RETURN;
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'flux'
      AND table_name = 'flux_migrations'
      AND column_name = 'tenant_schema'
  ) INTO legacy_without_tenant;

  IF legacy_without_tenant THEN
    SELECT COUNT(*)::bigint INTO row_count FROM flux.flux_migrations;
    IF row_count > 0 THEN
      RAISE EXCEPTION
        'flux.flux_migrations legacy global ledger has % row(s); tenant-scoped upgrade required (see Flux operator runbook)',
        row_count;
    END IF;
    DROP TABLE flux.flux_migrations;
    ${FLUX_MIGRATIONS_TABLE_DDL};
  END IF;
END $$;
`.trim();
}

/** @deprecated Use {@link buildFluxMigrationsLedgerEnsureSql} with tenant schema. */
export const FLUX_MIGRATIONS_DDL = `CREATE SCHEMA IF NOT EXISTS flux;\n${FLUX_MIGRATIONS_TABLE_DDL}`;

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

export type MigrationPlanStatus = "skip" | "apply" | "conflict";

export type MigrationPlanEntry = {
  file: LocalMigrationFile;
  status: MigrationPlanStatus;
  appliedChecksum?: string;
};

/** Plan entries sorted by version/filename (migration timeline order). */
export function migrationPlanTimeline(
  plan: MigrationPlanResult,
): MigrationPlanEntry[] {
  const entries: MigrationPlanEntry[] = [];
  for (const file of plan.skip) {
    entries.push({ file, status: "skip" });
  }
  for (const file of plan.apply) {
    entries.push({ file, status: "apply" });
  }
  for (const { file, appliedChecksum } of plan.conflicts) {
    entries.push({ file, status: "conflict", appliedChecksum });
  }
  return entries.sort((a, b) => a.file.version.localeCompare(b.file.version));
}

/** SHA-256 hex digest of normalized migration file content (UTF-8). */
export function migrationChecksum(content: string): string {
  return createHash("sha256")
    .update(normalizePushSql(content), "utf8")
    .digest("hex");
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
 * Checksums are computed on {@link normalizePushSql} output; `content` is normalized for push.
 */
export async function loadLocalMigrations(
  paths: string[],
): Promise<LocalMigrationFile[]> {
  const out: LocalMigrationFile[] = [];
  for (const path of paths) {
    const raw = await readFile(path, "utf8");
    const content = normalizePushSql(raw);
    const filename = path.split("/").pop() ?? path;
    const version = filename;
    out.push({
      version,
      filename,
      path,
      content,
      checksum: migrationChecksum(raw),
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

/** SQL to list applied migrations for one tenant schema (table may not exist yet). */
export function listFluxMigrationsSql(tenantSchema: string): string {
  const ts = sqlLiteral(tenantSchema);
  return `
SELECT version, filename, checksum, applied_at AS "appliedAt"
FROM flux.flux_migrations
WHERE tenant_schema = ${ts}
ORDER BY version ASC;
`.trim();
}

/** @deprecated Use {@link listFluxMigrationsSql} with tenant schema. */
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
  tenantSchema: string;
  userSql: string;
  migration: MigrationPushMeta;
}): string {
  const { tenantSchema, userSql, migration } = input;
  const ts = sqlLiteral(tenantSchema);
  const v = sqlLiteral(migration.version);
  const f = sqlLiteral(migration.filename);
  const c = sqlLiteral(migration.checksum);

  const insert = `
INSERT INTO flux.flux_migrations (tenant_schema, version, filename, checksum)
VALUES (${ts}, ${v}, ${f}, ${c});`.trim();

  return [
    buildFluxMigrationsLedgerEnsureSql(tenantSchema),
    normalizePushSql(userSql).trim(),
    insert,
  ]
    .filter((s) => s.length > 0)
    .join("\n\n");
}

/** Lookup ledger checksum for a version (literal-safe for PushPgClient single-arg query). */
export function selectMigrationChecksumSql(
  version: string,
  tenantSchema: string,
): string {
  const ts = sqlLiteral(tenantSchema);
  return `SELECT checksum FROM flux.flux_migrations WHERE tenant_schema = ${ts} AND version = ${sqlLiteral(version)} LIMIT 1`;
}

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

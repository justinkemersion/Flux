import { relative, resolve } from "node:path";

import { normalizePushSql, sqlLiteral } from "./sql-migrations.ts";
import { embedSqlStatement } from "./sql-compose.ts";

/**
 * Repeatable-script ledger DDL — lives in `flux` schema (not exposed via PostgREST).
 * `_STATEMENT`-class constant: complete executable statement including trailing `;`.
 */
export const FLUX_REPEATABLE_SCRIPTS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS flux.flux_repeatable_scripts (
  tenant_schema text NOT NULL,
  script_id text NOT NULL,
  filename text NOT NULL,
  checksum text NOT NULL,
  run_count integer NOT NULL DEFAULT 0,
  last_applied_at timestamptz,
  PRIMARY KEY (tenant_schema, script_id)
);
`.trim();

/** Idempotent ensure for the repeatable-scripts ledger table. */
export function buildRepeatableLedgerEnsureSql(_tenantSchema: string): string {
  return `
CREATE SCHEMA IF NOT EXISTS flux;
${embedSqlStatement(FLUX_REPEATABLE_SCRIPTS_TABLE_DDL)}
`.trim();
}

export type RepeatablePushMeta = {
  scriptId: string;
  filename: string;
  checksum: string;
  force?: boolean;
};

export type RepeatableLedgerAction = "apply" | "skip" | "force_apply";

/**
 * Decides whether to skip, apply, or force-apply a repeatable script given a ledger row (if any).
 */
export function resolveRepeatableLedgerAction(
  existing: { checksum: string } | undefined,
  incoming: Pick<RepeatablePushMeta, "checksum">,
  force: boolean,
): RepeatableLedgerAction {
  if (!existing) return "apply";
  if (existing.checksum !== incoming.checksum) return "apply";
  if (force) return "force_apply";
  return "skip";
}

/** Lookup ledger checksum for a script id (literal-safe for PushPgClient single-arg query). */
export function selectRepeatableChecksumSql(
  scriptId: string,
  tenantSchema: string,
): string {
  const ts = sqlLiteral(tenantSchema);
  return `SELECT checksum FROM flux.flux_repeatable_scripts WHERE tenant_schema = ${ts} AND script_id = ${sqlLiteral(scriptId)} LIMIT 1`;
}

/**
 * Wraps user SQL for a repeatable push: ensure ledger, run user SQL, upsert row.
 * Caller must run {@link resolveRepeatableLedgerAction} first to skip when unchanged.
 */
export function buildRepeatablePushSql(input: {
  tenantSchema: string;
  userSql: string;
  meta: RepeatablePushMeta;
}): string {
  const { tenantSchema, userSql, meta } = input;
  const ts = sqlLiteral(tenantSchema);
  const id = sqlLiteral(meta.scriptId);
  const fn = sqlLiteral(meta.filename);
  const cs = sqlLiteral(meta.checksum);

  const upsert = `
INSERT INTO flux.flux_repeatable_scripts
  (tenant_schema, script_id, filename, checksum, run_count, last_applied_at)
VALUES
  (${ts}, ${id}, ${fn}, ${cs}, 1, now())
ON CONFLICT (tenant_schema, script_id) DO UPDATE SET
  checksum = EXCLUDED.checksum,
  filename = EXCLUDED.filename,
  run_count = flux.flux_repeatable_scripts.run_count + 1,
  last_applied_at = now();`.trim();

  return [
    buildRepeatableLedgerEnsureSql(tenantSchema),
    normalizePushSql(userSql).trim(),
    upsert,
  ]
    .filter((s) => s.length > 0)
    .join("\n\n");
}

/** Effective byte length when repeatable metadata wraps user SQL (for size limits). */
export function repeatablePushEffectiveSqlBytes(
  userSql: string,
  meta: RepeatablePushMeta,
  tenantSchema: string,
): number {
  return Buffer.byteLength(
    buildRepeatablePushSql({ tenantSchema, userSql, meta }),
    "utf8",
  );
}

export function repeatableUnchangedSkipMessage(scriptId: string): string {
  return [
    `Repeatable script ${scriptId} is unchanged; skipping.`,
    "Use --force to run anyway.",
  ].join("\n");
}

export function repeatableChangedReapplyMessage(
  scriptId: string,
  previousChecksum: string,
  newChecksum: string,
): string {
  return [
    `Repeatable script ${scriptId} changed since last successful run; reapplying.`,
    `Previous checksum: ${previousChecksum}`,
    `New checksum: ${newChecksum}`,
  ].join("\n");
}

export function repeatableForceApplyMessage(scriptId: string): string {
  return `Force applying repeatable script ${scriptId} even though checksum is unchanged.`;
}

export function repeatableAppliedMessage(
  scriptId: string,
  checksum: string,
): string {
  return [`Applied repeatable script ${scriptId}.`, `Checksum: ${checksum}`].join(
    "\n",
  );
}

export function repeatableApplyingMessage(scriptId: string): string {
  return `Applying repeatable script ${scriptId}...`;
}

/**
 * Default repeatable `script_id`: normalized relative path from CWD (POSIX `/`, no `./`).
 */
export function defaultRepeatableScriptId(
  resolvedPath: string,
  cwd: string,
): string {
  const rel = relative(cwd, resolve(resolvedPath));
  const posix = rel.split(/[/\\]/u).join("/");
  if (posix.startsWith("./")) {
    return posix.slice(2);
  }
  return posix;
}

export type SingleFilePushScriptMode = "raw" | "versioned";

/**
 * Infers default push mode for a single SQL file when `--mode` is omitted.
 * Files under `migrations/` or `flux/migrations/` default to versioned; else raw.
 */
export function inferDefaultSingleFilePushMode(
  resolvedPath: string,
  cwd: string,
): SingleFilePushScriptMode {
  const rel = defaultRepeatableScriptId(resolvedPath, cwd);
  if (
    rel.startsWith("migrations/") ||
    rel.startsWith("flux/migrations/")
  ) {
    return "versioned";
  }
  return "raw";
}

export const PUSH_SCRIPT_MODES = ["raw", "versioned", "repeatable"] as const;
export type PushScriptMode = (typeof PUSH_SCRIPT_MODES)[number];

export function parsePushScriptMode(value: string): PushScriptMode | null {
  const v = value.trim().toLowerCase();
  if (v === "raw" || v === "versioned" || v === "repeatable") {
    return v;
  }
  return null;
}

export function versionedMigrationConflictMessage(
  migration: { filename: string; version: string },
  appliedChecksum: string,
  currentChecksum: string,
): string {
  const name = migration.filename || migration.version;
  return [
    `Migration ${name} was already applied with a different checksum.`,
    "Refusing to mutate versioned migration history.",
    "",
    `Applied checksum: ${appliedChecksum}`,
    `Current checksum: ${currentChecksum}`,
  ].join("\n");
}

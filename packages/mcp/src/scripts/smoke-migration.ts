/**
 * Harmless no-op migration generator for MCP Phase 4+ live smoke tests.
 *
 * Ledger rows are real history — smoke migrations must never contain DDL/DML.
 */

export const NOOP_SMOKE_MIGRATION_VERSION = "9999";
export const NOOP_SMOKE_MIGRATION_PREFIX = "mcp_noop_smoke";

const FORBIDDEN_SQL_PATTERNS = [
  /\bCREATE\b/i,
  /\bALTER\b/i,
  /\bDROP\b/i,
  /\bINSERT\b/i,
  /\bUPDATE\b/i,
  /\bDELETE\b/i,
  /\bTRUNCATE\b/i,
  /\bGRANT\b/i,
  /\bREVOKE\b/i,
  /\bMERGE\b/i,
  /\bCOPY\b/i,
  /\bCALL\b/i,
  /\bDO\s+\$\$/i,
] as const;

export interface NoopSmokeMigrationArtifact {
  filename: string;
  sql: string;
  logMeta: {
    kind: typeof NOOP_SMOKE_MIGRATION_PREFIX;
    suffix: string;
    version: typeof NOOP_SMOKE_MIGRATION_VERSION;
  };
}

export function noopSmokeMigrationFilename(suffix: string): string {
  const safe = suffix.trim().replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "run";
  return `${NOOP_SMOKE_MIGRATION_VERSION}_${NOOP_SMOKE_MIGRATION_PREFIX}_${safe}.sql`;
}

/** Harmless smoke migration: comment + read-only SELECT version() only. */
export function buildNoopSmokeMigrationSql(suffix: string): string {
  return `-- flux mcp noop smoke ${suffix}\nSELECT version();\n`;
}

export function buildNoopSmokeMigration(suffix: string): NoopSmokeMigrationArtifact {
  const sql = buildNoopSmokeMigrationSql(suffix);
  assertNoopSmokeMigrationSql(sql);
  return {
    filename: noopSmokeMigrationFilename(suffix),
    sql,
    logMeta: {
      kind: NOOP_SMOKE_MIGRATION_PREFIX,
      suffix,
      version: NOOP_SMOKE_MIGRATION_VERSION,
    },
  };
}

export function assertNoopSmokeMigrationSql(sql: string): void {
  for (const pattern of FORBIDDEN_SQL_PATTERNS) {
    if (pattern.test(sql)) {
      throw new Error(`Smoke migration must not contain ${String(pattern)} statements.`);
    }
  }
  if (!/\bSELECT\s+version\s*\(\s*\)\s*;/iu.test(sql)) {
    throw new Error("Smoke migration must include SELECT version();");
  }
}

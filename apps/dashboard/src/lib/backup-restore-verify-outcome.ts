/**
 * Post-`pg_restore` acceptance policy for `flux backup verify`.
 *
 * Non-empty restores still require at least one user table.
 * Schema-only v2 `tenant_export` dumps (zero user tables) are valid only when
 * the tenant API schema is present after restore **and** the dump TOC agrees
 * the source was empty — a corrupt dump that listed tables but restored none
 * still fails.
 */

export type RestoreVerifyBackupKind = "project_db" | "tenant_export";

export type RestoreVerifyClassification =
  | "restore_verified"
  | "restorable_empty_tenant";

export type RestoreVerifyTocTable = {
  schema: string;
  name: string;
};

export type RestoreVerifyToc = {
  schemas: readonly string[];
  tables: readonly RestoreVerifyTocTable[];
};

export type RestoreVerifyOutcome =
  | { ok: true; classification: RestoreVerifyClassification }
  | { ok: false; error: string };

export const RESTORE_VERIFY_NO_USER_TABLES =
  "Restore verification failed: no user tables found after pg_restore.";

/** User schemas after restore (excludes catalog / toast / temp). */
export const RESTORE_VERIFY_SCHEMA_LIST_SQL =
  "SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%' ORDER BY 1;";

/** Non-system tables, including those in `public` and tenant schemas. */
export const RESTORE_VERIFY_TABLE_COUNT_SQL =
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema');";

/**
 * Parse `pg_restore --list` TOC text.
 * SCHEMA lines look like `2; 3079 16384 SCHEMA - t_<id>_api postgres`.
 * TABLE lines look like `3; 1259 16385 TABLE t_<id>_api items postgres`.
 * `TABLE DATA` / other object kinds are ignored for emptiness matching.
 */
export function parsePgRestoreList(tocText: string): RestoreVerifyToc {
  const schemas: string[] = [];
  const tables: RestoreVerifyTocTable[] = [];
  for (const rawLine of tocText.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";")) continue;

    const schemaMatch = line.match(/^\d+; \d+ \d+ SCHEMA (?:- )?(\S+)/u);
    if (schemaMatch) {
      const name = schemaMatch[1];
      if (name) schemas.push(name);
      continue;
    }

    // Negative lookahead keeps `TABLE DATA` from counting as a user table.
    const tableMatch = line.match(/^\d+; \d+ \d+ TABLE (?!DATA\b)(\S+) (\S+)/u);
    if (tableMatch) {
      const schema = tableMatch[1];
      const name = tableMatch[2];
      if (schema && name) tables.push({ schema, name });
    }
  }
  return { schemas, tables };
}

export function parseRestoredSchemaList(psqlText: string): string[] {
  return psqlText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function classifyRestoreVerification(input: {
  kind: RestoreVerifyBackupKind;
  tableCount: number;
  restoredSchemas: readonly string[];
  expectedTenantSchema: string | null;
  toc: RestoreVerifyToc | null;
}): RestoreVerifyOutcome {
  if (!Number.isFinite(input.tableCount) || input.tableCount < 0) {
    return { ok: false, error: RESTORE_VERIFY_NO_USER_TABLES };
  }

  if (input.tableCount > 0) {
    return { ok: true, classification: "restore_verified" };
  }

  if (input.kind !== "tenant_export") {
    return { ok: false, error: RESTORE_VERIFY_NO_USER_TABLES };
  }

  const expected = input.expectedTenantSchema?.trim() ?? "";
  if (!expected) {
    return {
      ok: false,
      error:
        "Restore verification failed: missing expected tenant schema for empty tenant_export.",
    };
  }

  if (!input.restoredSchemas.includes(expected)) {
    return {
      ok: false,
      error: `Restore verification failed: expected tenant schema ${expected} not found after pg_restore.`,
    };
  }

  if (!input.toc) {
    return {
      ok: false,
      error:
        "Restore verification failed: could not read dump TOC for empty tenant export.",
    };
  }

  if (!input.toc.schemas.includes(expected)) {
    return {
      ok: false,
      error: `Restore verification failed: dump TOC is missing expected tenant schema ${expected}.`,
    };
  }

  const tocUserTables = input.toc.tables.filter((t) => t.schema === expected);
  if (tocUserTables.length > 0) {
    return {
      ok: false,
      error: `Restore verification failed: dump TOC lists ${String(tocUserTables.length)} user table(s) in ${expected} but none were found after pg_restore.`,
    };
  }

  return { ok: true, classification: "restorable_empty_tenant" };
}

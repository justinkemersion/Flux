import { defaultTenantApiSchemaFromProjectId, FLUX_PROJECT_HASH_HEX_LEN } from "@flux/core";
import {
  buildMigrationPushSql,
  type MigrationPushMeta,
} from "@flux/core/sql-migrations";
import {
  repeatablePushEffectiveSqlBytes,
  type RepeatablePushMeta,
} from "@flux/core/sql-repeatable-scripts";

/** Matches pooled push route body limit (4 MiB UTF-8 byte length). */
export const POOLED_PUSH_MAX_SQL_BYTES = 4 * 1024 * 1024;

export function extractPooledPushBearer(header: string | null): string | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
}

export function isValidFluxProjectHash(hash: string): boolean {
  return hash.length === FLUX_PROJECT_HASH_HEX_LEN && /^[a-f0-9]+$/u.test(hash);
}

export function parseMigrationPushMeta(input: unknown):
  | { ok: true; migration: MigrationPushMeta }
  | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "migration must be an object" };
  }
  const o = input as Record<string, unknown>;
  if (
    typeof o.version !== "string" ||
    typeof o.filename !== "string" ||
    typeof o.checksum !== "string"
  ) {
    return {
      ok: false,
      error: 'migration requires string "version", "filename", and "checksum"',
    };
  }
  const version = o.version.trim();
  const filename = o.filename.trim();
  const checksum = o.checksum.trim();
  if (!version || !filename || !checksum) {
    return { ok: false, error: "migration fields must be non-empty" };
  }
  if (!/^[a-f0-9]{64}$/u.test(checksum)) {
    return { ok: false, error: "migration.checksum must be a 64-char sha256 hex" };
  }
  return { ok: true, migration: { version, filename, checksum } };
}

export function parseRepeatablePushMeta(input: unknown):
  | { ok: true; repeatable: RepeatablePushMeta }
  | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "repeatable must be an object" };
  }
  const o = input as Record<string, unknown>;
  if (
    typeof o.scriptId !== "string" ||
    typeof o.filename !== "string" ||
    typeof o.checksum !== "string"
  ) {
    return {
      ok: false,
      error:
        'repeatable requires string "scriptId", "filename", and "checksum"',
    };
  }
  const scriptId = o.scriptId.trim();
  const filename = o.filename.trim();
  const checksum = o.checksum.trim();
  if (!scriptId || !filename || !checksum) {
    return { ok: false, error: "repeatable fields must be non-empty" };
  }
  if (!/^[a-f0-9]{64}$/u.test(checksum)) {
    return {
      ok: false,
      error: "repeatable.checksum must be a 64-char sha256 hex",
    };
  }
  const force = o.force === true;
  return {
    ok: true,
    repeatable: { scriptId, filename, checksum, ...(force ? { force: true } : {}) },
  };
}

export type ParsedPooledPushBody = {
  hash: string;
  sql: string;
  migration?: MigrationPushMeta;
  repeatable?: RepeatablePushMeta;
};

export function parsePooledPushJsonBody(input: unknown):
  | { ok: true } & ParsedPooledPushBody
  | { ok: false; error: string } {
  if (
    !input ||
    typeof input !== "object" ||
    !("hash" in input) ||
    !("sql" in input) ||
    typeof (input as { hash: unknown }).hash !== "string" ||
    typeof (input as { sql: unknown }).sql !== "string"
  ) {
    return {
      ok: false,
      error: 'Expected JSON body with string "hash" and "sql" fields',
    };
  }
  const hash = (input as { hash: string }).hash.trim().toLowerCase();
  const sql = (input as { sql: string }).sql;
  let migration: MigrationPushMeta | undefined;
  let repeatable: RepeatablePushMeta | undefined;
  if ("migration" in input && (input as { migration: unknown }).migration != null) {
    const parsed = parseMigrationPushMeta(
      (input as { migration: unknown }).migration,
    );
    if (!parsed.ok) return parsed;
    migration = parsed.migration;
  }
  if ("repeatable" in input && (input as { repeatable: unknown }).repeatable != null) {
    if (migration) {
      return {
        ok: false,
        error: "Provide only one of migration or repeatable metadata",
      };
    }
    const parsed = parseRepeatablePushMeta(
      (input as { repeatable: unknown }).repeatable,
    );
    if (!parsed.ok) return parsed;
    repeatable = parsed.repeatable;
  }
  return {
    ok: true,
    hash,
    sql,
    ...(migration ? { migration } : {}),
    ...(repeatable ? { repeatable } : {}),
  };
}

/** Byte length used for push limit when migration metadata wraps user SQL. */
export function pooledPushEffectiveSqlBytes(
  sql: string,
  migration?: MigrationPushMeta,
  tenantSchema?: string,
  repeatable?: RepeatablePushMeta,
): number {
  if (repeatable) {
    const schema = tenantSchema ?? "t_000000000000_api";
    return repeatablePushEffectiveSqlBytes(sql, repeatable, schema);
  }
  if (!migration) return Buffer.byteLength(sql, "utf8");
  const schema = tenantSchema ?? "t_000000000000_api";
  return Buffer.byteLength(
    buildMigrationPushSql({ tenantSchema: schema, userSql: sql, migration }),
    "utf8",
  );
}

export function validatePooledPushSqlPayload(
  sql: string,
  maxBytes: number,
  migration?: MigrationPushMeta,
  tenantSchema?: string,
  repeatable?: RepeatablePushMeta,
):
  | { ok: true }
  | { ok: false; error: string; status: 400 | 413 } {
  if (sql.length === 0) {
    return { ok: false, error: "sql is empty", status: 400 };
  }
  if (
    pooledPushEffectiveSqlBytes(sql, migration, tenantSchema, repeatable) >
    maxBytes
  ) {
    return { ok: false, error: "sql exceeds maximum size", status: 413 };
  }
  return { ok: true };
}

export function validatePooledPushServiceRole(
  payload: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  if (payload.role !== "service_role") {
    return { ok: false, error: "Forbidden: service_role required" };
  }
  return { ok: true };
}

/**
 * Resolves the tenant API schema name from the catalog project UUID (same as push route).
 */
export function tenantApiSchemaFromProjectId(projectId: string):
  | { ok: true; schema: string }
  | { ok: false; error: string } {
  try {
    return { ok: true, schema: defaultTenantApiSchemaFromProjectId(projectId) };
  } catch {
    return { ok: false, error: "Derived shortId is malformed; refusing push" };
  }
}

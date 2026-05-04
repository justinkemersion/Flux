import { FLUX_PROJECT_HASH_HEX_LEN } from "@flux/core";
import { deriveShortId } from "@flux/core/standalone";

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

export function parsePooledPushJsonBody(input: unknown):
  | { ok: true; hash: string; sql: string }
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
  return { ok: true, hash, sql };
}

export function validatePooledPushSqlPayload(
  sql: string,
  maxBytes: number,
):
  | { ok: true }
  | { ok: false; error: string; status: 400 | 413 } {
  if (sql.length === 0) {
    return { ok: false, error: "sql is empty", status: 400 };
  }
  if (Buffer.byteLength(sql, "utf8") > maxBytes) {
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
  const shortId = deriveShortId(projectId);
  if (!/^[a-f0-9]{12}$/.test(shortId)) {
    return { ok: false, error: "Derived shortId is malformed; refusing push" };
  }
  return { ok: true, schema: `t_${shortId}_api` };
}

/**
 * Centralized PostgreSQL role naming for private database access (v2 pooled).
 * All generated identifiers are sanitized, quoted at SQL emit time, and <= 63 bytes.
 */

const PG_IDENTIFIER_MAX_BYTES = 63;
const HASH_SEGMENT_RE = /^[a-f0-9]{7}$/u;
const SUFFIX_SEGMENT_RE = /^[a-f0-9]{8}$/u;

export type DbAccessLevel = "readonly" | "readwrite";

export function sanitizeDbAccessHashSegment(hash: string): string {
  const h = hash.trim().toLowerCase();
  if (!HASH_SEGMENT_RE.test(h)) {
    throw new Error("Project hash must be a 7-char hex id for db access roles.");
  }
  return h;
}

export function sanitizeDbAccessSuffixSegment(suffix: string): string {
  const s = suffix.trim().toLowerCase();
  if (!SUFFIX_SEGMENT_RE.test(s)) {
    throw new Error("Temporary db access suffix must be 8 hex characters.");
  }
  return s;
}

export function assertPgRoleNameByteLength(name: string): void {
  if (Buffer.byteLength(name, "utf8") > PG_IDENTIFIER_MAX_BYTES) {
    throw new Error(
      `Generated PostgreSQL role name exceeds ${String(PG_IDENTIFIER_MAX_BYTES)} bytes: "${name}".`,
    );
  }
  if (!/^[a-z][a-z0-9_]*$/u.test(name)) {
    throw new Error(`Invalid PostgreSQL role name "${name}".`);
  }
}

export function fluxTenantGroupRoleName(
  hash: string,
  access: "readonly" | "readwrite",
): string {
  const h = sanitizeDbAccessHashSegment(hash);
  const suffix = access === "readonly" ? "ro" : "rw";
  const name = `flux_tenant_${h}_${suffix}`;
  assertPgRoleNameByteLength(name);
  return name;
}

export function fluxTempLoginRoleName(
  hash: string,
  access: "readonly" | "readwrite",
  suffix: string,
): string {
  const h = sanitizeDbAccessHashSegment(hash);
  const s = sanitizeDbAccessSuffixSegment(suffix);
  const mid = access === "readonly" ? "ro" : "rw";
  const name = `flux_temp_${mid}_${h}_${s}`;
  assertPgRoleNameByteLength(name);
  return name;
}

export function quotePgIdent(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

export const DB_ACCESS_TTL_DEFAULT_READONLY_SECONDS = 60 * 60;
export const DB_ACCESS_TTL_DEFAULT_READWRITE_SECONDS = 30 * 60;
export const DB_ACCESS_TTL_MAX_SECONDS = 8 * 60 * 60;

export function normalizeDbAccessTtlSeconds(input: {
  access: DbAccessLevel;
  ttlSeconds?: number;
}): number {
  const fallback =
    input.access === "readonly"
      ? DB_ACCESS_TTL_DEFAULT_READONLY_SECONDS
      : DB_ACCESS_TTL_DEFAULT_READWRITE_SECONDS;
  const ttl = input.ttlSeconds ?? fallback;
  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw new Error("ttlSeconds must be a positive number.");
  }
  if (ttl > DB_ACCESS_TTL_MAX_SECONDS) {
    throw new Error(
      `ttlSeconds must be <= ${String(DB_ACCESS_TTL_MAX_SECONDS)} (8 hours).`,
    );
  }
  return Math.floor(ttl);
}

export function dbAccessReadwriteEnabled(): boolean {
  const v = process.env.FLUX_DB_ACCESS_ALLOW_READWRITE?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

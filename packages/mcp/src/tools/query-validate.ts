/**
 * Read-only SQL validation + bounded LIMIT enforcement for `flux.query.readonly`.
 *
 * This is the security core of the read-only query tool. It is intentionally
 * conservative: it rejects anything that is not a single `SELECT`/`WITH`
 * statement, rejects any non-read / privileged keyword, and wraps the statement
 * in a hard outer LIMIT so the row cap cannot be bypassed by the caller's SQL.
 */

import { stripSqlComments } from "@flux/core/sql-ddl-classify";
import { InvalidInputError } from "../result";

export const DEFAULT_ROW_CAP = 100;
export const MAX_ROW_CAP = 1000;

/**
 * Disallowed (non-read / privileged) keywords. Matched as whole words on the
 * comment-stripped statement. A read tool should never run these; conservative
 * over-rejection is preferred to leaking write capability.
 */
const FORBIDDEN_KEYWORDS = [
  "insert",
  "update",
  "delete",
  "drop",
  "alter",
  "create",
  "grant",
  "revoke",
  "truncate",
  "copy",
  "call",
  "do",
  "merge",
] as const;

const FORBIDDEN_KEYWORD_RE = new RegExp(
  `\\b(?:${FORBIDDEN_KEYWORDS.join("|")})\\b`,
  "iu",
);

const SECURITY_DEFINER_RE = /security\s+definer/iu;

function clampRowCap(rowCap: number | undefined): number {
  const value = rowCap ?? DEFAULT_ROW_CAP;
  if (!Number.isInteger(value) || value <= 0) return DEFAULT_ROW_CAP;
  return Math.min(value, MAX_ROW_CAP);
}

export interface ValidatedReadonlyQuery {
  /** Wrapped SQL with an outer LIMIT of (cap + 1) to detect truncation. */
  wrapped: string;
  /** Effective row cap applied. */
  cap: string extends never ? never : number;
}

/**
 * Validate that `rawSql` is a single read-only statement and return a wrapped
 * form that enforces the row cap. Throws {@link InvalidInputError} on any
 * violation (which is how write attempts are denied — before any DB access).
 */
export function validateReadonlyQuery(
  rawSql: unknown,
  options?: { rowCap?: number },
): { wrapped: string; cap: number } {
  if (typeof rawSql !== "string" || rawSql.trim().length === 0) {
    throw new InvalidInputError("Missing required string argument: sql");
  }

  const stripped = stripSqlComments(rawSql).trim();
  if (stripped.length === 0) {
    throw new InvalidInputError("SQL is empty after removing comments.");
  }

  // Single statement only: tolerate a single trailing ";" but reject any
  // additional statement separators.
  const withoutTrailing = stripped.replace(/;+\s*$/u, "");
  if (withoutTrailing.includes(";")) {
    throw new InvalidInputError("Only a single SQL statement is allowed.");
  }

  if (!/^(?:select|with)\b/iu.test(withoutTrailing)) {
    throw new InvalidInputError(
      "Only SELECT or WITH (read-only) queries are allowed.",
    );
  }

  if (FORBIDDEN_KEYWORD_RE.test(withoutTrailing)) {
    throw new InvalidInputError(
      "Query contains a disallowed (non-read or privileged) keyword.",
    );
  }
  if (SECURITY_DEFINER_RE.test(withoutTrailing)) {
    throw new InvalidInputError("Query contains SECURITY DEFINER.");
  }

  const cap = clampRowCap(options?.rowCap);
  // Outer LIMIT enforces the cap regardless of any inner LIMIT. cap + 1 lets the
  // executor detect (and report) truncation.
  const wrapped = `SELECT * FROM (\n${withoutTrailing}\n) AS flux_readonly LIMIT ${String(cap + 1)}`;
  return { wrapped, cap };
}

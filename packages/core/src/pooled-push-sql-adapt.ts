import { assertFluxApiSchemaIdentifier } from "./api-schema-strategy.ts";

export type PooledPushSqlAdaptInput = {
  tenantSchema: string;
  tenantRole: string;
};

function quoteIdent(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

/** A half-open `[start, end)` span of executable SQL, outside any comment or literal. */
type CodeSpan = { start: number; end: number };

/**
 * Splits SQL into the spans that are executable code, skipping every lexical
 * region where a bare word must never be treated as an identifier:
 *
 * - line comments introduced by a double dash
 * - block comments delimited by slash-star / star-slash, which PostgreSQL nests
 * - `'single-quoted strings'` including `''` escapes, and `E'...'` backslash escapes
 * - `"double-quoted identifiers"` including `""` escapes
 * - `$$ dollar-quoted $$` and `$tag$ dollar-quoted $tag$` bodies
 *
 * Deliberately not a parser: it only needs to know where code *is not*, which is
 * exactly the property that keeps rewrites out of comments and dynamic SQL.
 */
export function scanSqlCodeSpans(sql: string): CodeSpan[] {
  const spans: CodeSpan[] = [];
  let codeStart = 0;
  let i = 0;

  const pushCode = (end: number): void => {
    if (end > codeStart) spans.push({ start: codeStart, end });
  };

  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    // -- line comment
    if (ch === "-" && next === "-") {
      pushCode(i);
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl;
      codeStart = i;
      continue;
    }

    // /* block comment */ — nesting, per PostgreSQL
    if (ch === "/" && next === "*") {
      pushCode(i);
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth += 1;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      codeStart = i;
      continue;
    }

    // 'string literal' — E'' also honours backslash escapes
    if (ch === "'") {
      // Only a standalone E prefix makes backslashes escapes; an identifier that
      // merely ends in "e" does not.
      const escapeString = /(?:^|[^A-Za-z0-9_$])[eE]$/.test(
        sql.slice(Math.max(0, i - 2), i),
      );
      pushCode(i);
      i += 1;
      while (i < sql.length) {
        if (escapeString && sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      codeStart = i;
      continue;
    }

    // "quoted identifier"
    if (ch === '"') {
      pushCode(i);
      i += 1;
      while (i < sql.length) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      codeStart = i;
      continue;
    }

    // $$ ... $$ or $tag$ ... $tag$
    if (ch === "$") {
      const tag = /^\$[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF]*\$|^\$\$/.exec(
        sql.slice(i),
      );
      if (tag) {
        const delimiter = tag[0];
        pushCode(i);
        const close = sql.indexOf(delimiter, i + delimiter.length);
        i = close === -1 ? sql.length : close + delimiter.length;
        codeStart = i;
        continue;
      }
    }

    i += 1;
  }

  pushCode(sql.length);
  return spans;
}

/**
 * Projection of the code spans into one string, with an index map back to the
 * original offsets so a match found in the projection can be edited in place.
 */
type CodeProjection = { text: string; offsets: number[] };

function project(sql: string, spans: CodeSpan[]): CodeProjection {
  let text = "";
  const offsets: number[] = [];
  for (const span of spans) {
    for (let i = span.start; i < span.end; i += 1) {
      text += sql[i];
      offsets.push(i);
    }
  }
  return { text, offsets };
}

type Edit = { start: number; end: number; replacement: string };

/** Maps a `[start, end)` range in the projection back to original offsets. */
function edit(projection: CodeProjection, start: number, end: number, replacement: string): Edit {
  return {
    start: projection.offsets[start]!,
    end: projection.offsets[end - 1]! + 1,
    replacement,
  };
}

/** Statement spans, split on semicolons that appear in code context. */
function splitStatements(sql: string, spans: CodeSpan[]): CodeSpan[][] {
  const statements: CodeSpan[][] = [];
  let current: CodeSpan[] = [];
  for (const span of spans) {
    let start = span.start;
    for (let i = span.start; i < span.end; i += 1) {
      if (sql[i] === ";") {
        if (i + 1 > start) current.push({ start, end: i + 1 });
        statements.push(current);
        current = [];
        start = i + 1;
      }
    }
    if (span.end > start) current.push({ start, end: span.end });
  }
  if (current.length > 0) statements.push(current);
  return statements;
}

const PRIVILEGE_STATEMENT =
  /\b(?:GRANT|REVOKE|ALTER\s+DEFAULT\s+PRIVILEGES|CREATE\s+POLICY)\b/i;
const AUTHENTICATED = /\bauthenticated\b/gi;
const GRANT_ON_SCHEMA_PUBLIC = /\b(?:GRANT|REVOKE)\b[\s\S]*?\bON\s+SCHEMA\s+(public)\b/gi;
const ADP_IN_SCHEMA_PUBLIC =
  /\b(?:ALTER\s+DEFAULT\s+PRIVILEGES)\b[\s\S]*?\bIN\s+SCHEMA\s+(public)\b/gi;

/**
 * Rewrites Supabase / Foundry-style privilege SQL for v2_shared pooled push.
 *
 * Execution context:
 * - `SET LOCAL ROLE t_<shortId>_role` — user SQL runs as the tenant role, never the control plane role.
 * - `SET LOCAL search_path TO t_<shortId>_api` — unqualified DDL/DML resolves in the tenant schema.
 * - The shared cluster has `anon` / `authenticator` but not a global `authenticated` role; runtime JWTs use `t_<shortId>_role`.
 *
 * Rewrites (idempotent for already-adapted SQL):
 * - `GRANT|REVOKE ... ON SCHEMA public` → tenant API schema
 * - `ALTER DEFAULT PRIVILEGES ... IN SCHEMA public` → tenant API schema
 * - `authenticated` role in GRANT/REVOKE/ALTER DEFAULT PRIVILEGES/CREATE POLICY → tenant role
 *
 * Rewrites apply **only to executable SQL**. Comments, string literals, quoted
 * identifiers and dollar-quoted bodies are never touched, so dynamic SQL such as
 * `EXECUTE format('grant authenticated to %I', r)` and prose in `--` comments keep
 * their original text. A statement is classified by the keywords that appear in its
 * own code context, so a privilege keyword inside a literal does not arm a rewrite.
 *
 * Deliberately does **not** rewrite qualified `public.<object>` references: on the shared
 * cluster `public` holds the PostgREST hook functions and any operator-installed extensions,
 * so blanket reschemaing would break references to objects that legitimately live there.
 *
 * Checksums and ledger rows remain on pre-adapt normalized file content; adaptation runs at execution only.
 */
export function adaptPooledPushSql(
  sql: string,
  input: PooledPushSqlAdaptInput,
): string {
  assertFluxApiSchemaIdentifier(input.tenantSchema);
  assertFluxApiSchemaIdentifier(input.tenantRole.replace(/_role$/, "_api"));
  const quotedSchema = quoteIdent(input.tenantSchema);
  const quotedRole = quoteIdent(input.tenantRole);

  const spans = scanSqlCodeSpans(sql);
  const edits: Edit[] = [];

  for (const statementSpans of splitStatements(sql, spans)) {
    const projection = project(sql, statementSpans);
    if (projection.text.trim() === "") continue;

    for (const pattern of [GRANT_ON_SCHEMA_PUBLIC, ADP_IN_SCHEMA_PUBLIC]) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(projection.text)) !== null) {
        const token = match.index + match[0].length - match[1]!.length;
        edits.push(edit(projection, token, token + match[1]!.length, quotedSchema));
      }
    }

    if (!PRIVILEGE_STATEMENT.test(projection.text)) continue;
    AUTHENTICATED.lastIndex = 0;
    let role: RegExpExecArray | null;
    while ((role = AUTHENTICATED.exec(projection.text)) !== null) {
      edits.push(
        edit(projection, role.index, role.index + role[0].length, quotedRole),
      );
    }
  }

  edits.sort((a, b) => b.start - a.start);
  let out = sql;
  for (const e of edits) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  }
  return out;
}

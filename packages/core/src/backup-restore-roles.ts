import {
  defaultTenantDdlRoleFromProjectId,
  defaultTenantRoleFromProjectId,
} from "./api-schema-strategy.ts";

/**
 * Roles a Flux dump can name that are not created inside a schema-only archive.
 *
 * `pg_dump` does not emit `CREATE ROLE`. Custom-format archives still store
 * `ALTER ... OWNER TO` (suppressed only when `pg_restore` is passed `--no-owner`)
 * and `CREATE POLICY ... TO <role>` (not an ACL, so `--no-acl` keeps it).
 * `GRANT` / `ALTER DEFAULT PRIVILEGES` are omitted when the dump used `--no-acl`
 * and are included otherwise.
 *
 * Stubs are `NOLOGIN` with no superuser and no `BYPASSRLS`. Callers that restore
 * into a disposable database drop the whole database afterwards. Callers that
 * restore into a live database keep the stubs, because the restored policies and
 * owners reference them.
 */

const ROLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const KEYWORDS = new Set([
  "admin",
  "all",
  "alter",
  "authorization",
  "check",
  "comment",
  "connect",
  "create",
  "current_role",
  "current_user",
  "default",
  "delete",
  "execute",
  "for",
  "from",
  "function",
  "functions",
  "grant",
  "group",
  "in",
  "insert",
  "maintain",
  "none",
  "on",
  "option",
  "owner",
  "policy",
  "privileges",
  "procedure",
  "procedures",
  "public",
  "references",
  "revoke",
  "role",
  "routine",
  "routines",
  "schema",
  "select",
  "sequence",
  "sequences",
  "session",
  "session_user",
  "set",
  "table",
  "tables",
  "temp",
  "temporary",
  "to",
  "trigger",
  "truncate",
  "update",
  "usage",
  "user",
  "using",
  "view",
  "with",
]);

type Tok = { kind: "ident" | "quoted" | "keyword"; value: string };

function isStubbableRoleName(name: string): boolean {
  if (!ROLE_NAME_RE.test(name)) return false;
  const lower = name.toLowerCase();
  if (lower === "public" || lower === "postgres" || lower === "none") return false;
  if (
    lower === "current_user" ||
    lower === "current_role" ||
    lower === "session_user"
  ) {
    return false;
  }
  if (lower.startsWith("pg_")) return false;
  return true;
}

function quoteRoleIdent(name: string): string {
  if (!isStubbableRoleName(name)) {
    throw new Error(`Refusing to create restore stub role "${name}".`);
  }
  return `"${name.replaceAll("\"", "\"\"")}"`;
}

/** Idempotent NOLOGIN stub. Does not grant superuser, BYPASSRLS, or login. */
export function buildIdempotentNologinRoleSql(roleName: string): string {
  const quoted = quoteRoleIdent(roleName);
  return `DO $$ BEGIN CREATE ROLE ${quoted} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`;
}

export function buildRestoreRoleStubSql(roleNames: readonly string[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const name of roleNames) {
    if (!isStubbableRoleName(name) || seen.has(name)) continue;
    seen.add(name);
    parts.push(buildIdempotentNologinRoleSql(name));
  }
  return parts.join("\n");
}

/**
 * Blank comments, string literals, and dollar-quoted bodies so role extraction
 * only sees executable SQL. Quoted identifiers are kept. Length and indexes
 * stay aligned with `sql` so semicolons inside literals are not statement ends.
 */
function maskNonExecutableSql(sql: string): string {
  const chars = new Array<string>(sql.length);
  for (let i = 0; i < sql.length; i += 1) chars[i] = sql[i]!;
  const blank = (start: number, end: number): void => {
    for (let i = start; i < end && i < chars.length; i += 1) {
      if (chars[i] !== "\n") chars[i] = " ";
    }
  };

  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    if (ch === "-" && next === "-") {
      const nl = sql.indexOf("\n", i);
      const end = nl === -1 ? sql.length : nl;
      blank(i, end);
      i = end;
      continue;
    }

    if (ch === "/" && next === "*") {
      const start = i;
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
      blank(start, i);
      continue;
    }

    if (ch === "'") {
      const escapeString = /(?:^|[^A-Za-z0-9_$])[eE]$/.test(
        sql.slice(Math.max(0, i - 2), i),
      );
      const start = i;
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
      blank(start, i);
      continue;
    }

    if (ch === '"') {
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
      continue;
    }

    if (ch === "$") {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (tag) {
        const delimiter = tag[0]!;
        const start = i;
        const close = sql.indexOf(delimiter, i + delimiter.length);
        i = close === -1 ? sql.length : close + delimiter.length;
        blank(start, i);
        continue;
      }
    }

    i += 1;
  }

  return chars.join("");
}

function splitStatements(masked: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < masked.length; i += 1) {
    if (masked[i] === ";") {
      const stmt = stripPsqlMeta(masked.slice(start, i));
      if (stmt) parts.push(stmt);
      start = i + 1;
    }
  }
  const tail = stripPsqlMeta(masked.slice(start));
  if (tail) parts.push(tail);
  return parts;
}

function stripPsqlMeta(stmt: string): string {
  return stmt
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("\\"))
    .join("\n")
    .trim();
}

function tokenize(stmt: string): Tok[] {
  const tokens: Tok[] = [];
  const re = /"((?:[^"]|"")*)"|([A-Za-z_][A-Za-z0-9_]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stmt))) {
    if (match[1] != null) {
      tokens.push({ kind: "quoted", value: match[1].replaceAll('""', '"') });
      continue;
    }
    const word = match[2]!;
    const lower = word.toLowerCase();
    if (KEYWORDS.has(lower)) {
      tokens.push({ kind: "keyword", value: lower });
    } else {
      tokens.push({ kind: "ident", value: word });
    }
  }
  return tokens;
}

function roleNameFromToken(tok: Tok | undefined): string | null {
  if (!tok || tok.kind === "keyword") return null;
  const name = tok.kind === "quoted" ? tok.value : tok.value.toLowerCase();
  return isStubbableRoleName(name) ? name : null;
}

function pushRole(out: string[], tok: Tok | undefined): void {
  const name = roleNameFromToken(tok);
  if (name) out.push(name);
}

function grantRoles(tokens: Tok[]): string[] {
  const toAt = tokens.findIndex((t) => t.kind === "keyword" && t.value === "to");
  if (toAt < 0) return [];
  const roles: string[] = [];
  const first = tokens[1];
  if (first && first.kind !== "keyword") {
    for (let i = 1; i < toAt; i += 1) pushRole(roles, tokens[i]);
  }
  for (let i = toAt + 1; i < tokens.length; i += 1) {
    const tok = tokens[i]!;
    if (
      tok.kind === "keyword" &&
      (tok.value === "with" ||
        tok.value === "grant" ||
        tok.value === "admin" ||
        tok.value === "option")
    ) {
      break;
    }
    pushRole(roles, tok);
  }
  return roles;
}

function revokeRoles(tokens: Tok[]): string[] {
  const fromAt = tokens.findIndex(
    (t) => t.kind === "keyword" && t.value === "from",
  );
  if (fromAt < 0) return [];
  const roles: string[] = [];
  const first = tokens[1];
  if (first && first.kind !== "keyword") {
    for (let i = 1; i < fromAt; i += 1) pushRole(roles, tokens[i]);
  }
  for (let i = fromAt + 1; i < tokens.length; i += 1) {
    const tok = tokens[i]!;
    if (tok.kind === "keyword" && tok.value === "cascade") break;
    pushRole(roles, tok);
  }
  return roles;
}

function policyRoles(tokens: Tok[]): string[] {
  const toAt = tokens.findIndex((t) => t.kind === "keyword" && t.value === "to");
  if (toAt < 0) return [];
  const roles: string[] = [];
  for (let i = toAt + 1; i < tokens.length; i += 1) {
    const tok = tokens[i]!;
    if (
      tok.kind === "keyword" &&
      (tok.value === "using" || tok.value === "with" || tok.value === "check")
    ) {
      break;
    }
    pushRole(roles, tok);
  }
  return roles;
}

function ownerRole(tokens: Tok[]): string[] {
  for (let i = 0; i < tokens.length - 2; i += 1) {
    if (
      tokens[i]?.kind === "keyword" &&
      tokens[i]?.value === "owner" &&
      tokens[i + 1]?.kind === "keyword" &&
      tokens[i + 1]?.value === "to"
    ) {
      const name = roleNameFromToken(tokens[i + 2]);
      return name ? [name] : [];
    }
  }
  return [];
}

function defaultPrivilegeRoles(tokens: Tok[]): string[] {
  const roles: string[] = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (
      tokens[i]?.kind === "keyword" &&
      tokens[i]?.value === "for" &&
      tokens[i + 1]?.kind === "keyword" &&
      (tokens[i + 1]?.value === "role" || tokens[i + 1]?.value === "user")
    ) {
      for (let j = i + 2; j < tokens.length; j += 1) {
        const tok = tokens[j]!;
        if (
          tok.kind === "keyword" &&
          (tok.value === "in" || tok.value === "grant" || tok.value === "revoke")
        ) {
          break;
        }
        pushRole(roles, tok);
      }
      break;
    }
  }
  const grantAt = tokens.findIndex(
    (t) => t.kind === "keyword" && (t.value === "grant" || t.value === "revoke"),
  );
  if (grantAt >= 0) {
    const tail = tokens.slice(grantAt);
    roles.push(
      ...(tail[0]?.value === "revoke" ? revokeRoles(tail) : grantRoles(tail)),
    );
  }
  return roles;
}

function rolesInStatement(stmt: string): string[] {
  const tokens = tokenize(stmt);
  if (tokens.length === 0) return [];
  const head = tokens[0]!;
  if (head.kind !== "keyword") return [];

  if (head.value === "grant") return grantRoles(tokens);
  if (head.value === "revoke") return revokeRoles(tokens);

  if (head.value === "create" && tokens[1]?.value === "policy") {
    return policyRoles(tokens);
  }

  if (
    head.value === "alter" &&
    tokens[1]?.value === "default" &&
    tokens[2]?.value === "privileges"
  ) {
    return defaultPrivilegeRoles(tokens);
  }

  if (head.value === "alter" && tokens[1]?.value === "role") {
    const name = roleNameFromToken(tokens[2]);
    return name ? [name] : [];
  }

  if (head.value === "comment" && tokens[1]?.value === "on" && tokens[2]?.value === "role") {
    const name = roleNameFromToken(tokens[3]);
    return name ? [name] : [];
  }

  if (
    head.value === "set" &&
    tokens[1]?.value === "session" &&
    tokens[2]?.value === "authorization"
  ) {
    const name = roleNameFromToken(tokens[3]);
    return name ? [name] : [];
  }

  if (head.value === "set" && tokens[1]?.value === "role") {
    const name = roleNameFromToken(tokens[2]);
    return name ? [name] : [];
  }

  return ownerRole(tokens);
}

function rolesCreatedInDump(statements: readonly string[]): Set<string> {
  const created = new Set<string>();
  for (const stmt of statements) {
    const tokens = tokenize(stmt);
    if (
      tokens[0]?.value === "create" &&
      (tokens[1]?.value === "role" || tokens[1]?.value === "user")
    ) {
      const name = roleNameFromToken(tokens[2]);
      if (name) created.add(name);
    }
  }
  return created;
}

/**
 * Role names a restore must already have: policy targets, grantees, owners,
 * default-privilege roles, and session-authorization targets.
 *
 * Names the dump itself `CREATE ROLE`s are omitted so the archive keeps its
 * own attributes. `postgres`, `PUBLIC`, and `pg_*` are omitted.
 */
export function extractRestoreRoleDependencies(sql: string): string[] {
  const statements = splitStatements(maskNonExecutableSql(sql));
  const created = rolesCreatedInDump(statements);
  const seen = new Set<string>();
  const roles: string[] = [];
  for (const stmt of statements) {
    for (const name of rolesInStatement(stmt)) {
      if (created.has(name) || seen.has(name)) continue;
      seen.add(name);
      roles.push(name);
    }
  }
  return roles;
}

/**
 * Roles to stub before restore: every dependency in `schemaSql`, plus the
 * catalog tenant runtime and DDL roles when `projectId` is known.
 */
export function collectRestoreRoleNames(
  schemaSql: string,
  projectId?: string,
): string[] {
  const names = extractRestoreRoleDependencies(schemaSql);
  if (projectId) {
    names.push(
      defaultTenantRoleFromProjectId(projectId),
      defaultTenantDdlRoleFromProjectId(projectId),
    );
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of names) {
    if (!isStubbableRoleName(name) || seen.has(name)) continue;
    seen.add(name);
    unique.push(name);
  }
  return unique;
}

/**
 * Disposable backup verification. `--no-owner` skips `ALTER ... OWNER TO`.
 * `--no-acl` skips GRANT / default privileges. `CREATE POLICY ... TO` still runs.
 */
export const BACKUP_VERIFY_PG_RESTORE_ARGS = ["--no-owner", "--no-acl"] as const;

/**
 * Live `pg_restore` (`flux db restore`). Owners, ACLs, and policies are applied.
 * Missing roles must be stubbed first; `--no-acl` is not used because it would
 * not remove policy targets and would drop grants.
 */
export const LIVE_PG_RESTORE_ARGS = ["--clean", "--if-exists"] as const;

/**
 * `pg_restore` exits 1 when it ignores statement errors. Exit 0 with a positive
 * ignored-error count is also a failed restore.
 */
export function pgRestoreRejectedReason(
  code: number | null,
  stderr: string,
): string | null {
  const ignored = /errors ignored on restore:\s*([0-9]+)/i.exec(stderr);
  const ignoredCount = ignored ? Number.parseInt(ignored[1]!, 10) : 0;
  if (code === 0 && ignoredCount === 0) return null;
  const detail = stderr.trim();
  return detail.length > 0
    ? `pg_restore failed (${String(code)}): ${detail.slice(0, 1500)}`
    : `pg_restore failed (exit ${String(code)}).`;
}

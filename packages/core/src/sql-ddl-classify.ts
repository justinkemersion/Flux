/**
 * Heuristic DDL classifier for migration SQL previews.
 * Not a SQL parser — labels common patterns only; never claims certainty.
 */

export type DdlMigrationSummary = {
  heuristic: true;
  creates: string[];
  alters: string[];
  drops: string[];
  indexCreates: string[];
  indexDrops: string[];
  policyChanges: string[];
  rlsChanges: string[];
  warnings: string[];
  hasDestructive: boolean;
};

const HEURISTIC_LABEL = "(heuristic — review SQL for certainty)";

/** Strip line (--) and block comments before pattern matching. */
export function stripSqlComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }
    if (sql[i] === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length - 1 && !(sql[i] === "*" && sql[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      continue;
    }
    out += sql[i]!;
    i += 1;
  }
  return out;
}

function uniqSorted(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function identFromGroups(m: RegExpExecArray, offset = 1): string {
  return (m[offset] ?? m[offset + 1] ?? m[offset + 2] ?? "").trim();
}

function cleanIdent(name: string): string | null {
  const n = name.trim();
  if (!n) return null;
  const lower = n.toLowerCase();
  if (
    lower === "if" ||
    lower === "not" ||
    lower === "exists" ||
    lower === "constraint" ||
    lower === "on" ||
    lower === "for" ||
    lower === "with" ||
    lower === "check" ||
    lower === "using" ||
    lower === "to" ||
    lower === "only"
  ) {
    return null;
  }
  return n;
}

function identFromGroupsClean(m: RegExpExecArray, offset = 1): string | null {
  return cleanIdent(identFromGroups(m, offset));
}

function scanAll(re: RegExp, sql: string): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    matches.push(m);
  }
  return matches;
}

const QUOTED_IDENT =
  '(?:"([^"]+)"|' +
  "'([^']+)'|" +
  "([a-zA-Z_][\\w$]*(?:\\.[a-zA-Z_][\\w$]*)?))";

/**
 * Classify common DDL patterns in a migration file.
 * Always returns heuristic: true on the summary object.
 */
export function classifyMigrationSql(sql: string): DdlMigrationSummary {
  const normalized = stripSqlComments(sql).replace(/\s+/gu, " ");

  const createTables = uniqSorted(
    scanAll(
      new RegExp(
        `\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${QUOTED_IDENT}`,
        "giu",
      ),
      normalized,
    )
      .map((m) => identFromGroupsClean(m))
      .filter((x): x is string => x != null),
  );

  const drops = uniqSorted(
    scanAll(
      new RegExp(
        `\\bDROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${QUOTED_IDENT}`,
        "giu",
      ),
      normalized,
    )
      .map((m) => identFromGroupsClean(m))
      .filter((x): x is string => x != null),
  );

  const alters: string[] = [];
  const alterRe = new RegExp(
    `\\bALTER\\s+TABLE\\s+(?:ONLY\\s+)?${QUOTED_IDENT}\\s+(ADD|DROP|ALTER)\\s+(?!CONSTRAINT\\b)(?:COLUMN\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?${QUOTED_IDENT}`,
    "giu",
  );
  for (const m of scanAll(alterRe, normalized)) {
    const table = identFromGroupsClean(m);
    const op = m[4]?.toUpperCase();
    const col = identFromGroupsClean(m, 5);
    if (table && col && op) {
      alters.push(`${table}.${col}`);
    }
  }

  const indexCreates = uniqSorted(
    scanAll(
      new RegExp(
        `\\bCREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?${QUOTED_IDENT}`,
        "giu",
      ),
      normalized,
    )
      .map((m) => identFromGroupsClean(m))
      .filter((x): x is string => x != null),
  );

  const indexDrops = uniqSorted(
    scanAll(
      new RegExp(
        `\\bDROP\\s+INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+EXISTS\\s+)?${QUOTED_IDENT}`,
        "giu",
      ),
      normalized,
    )
      .map((m) => identFromGroupsClean(m))
      .filter((x): x is string => x != null),
  );

  const policyChanges: string[] = [];
  const policyRe = new RegExp(
    `\\b(CREATE|ALTER|DROP)\\s+POLICY\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${QUOTED_IDENT}`,
    "giu",
  );
  for (const m of scanAll(policyRe, normalized)) {
    const verb = m[1]!.toLowerCase();
    const name = identFromGroupsClean(m, 2);
    if (name) policyChanges.push(`${verb} policy ${name}`);
  }

  const rlsChanges: string[] = [];
  const rlsRe = new RegExp(
    `\\bALTER\\s+TABLE\\s+${QUOTED_IDENT}\\s+(ENABLE|DISABLE)\\s+ROW\\s+LEVEL\\s+SECURITY`,
    "giu",
  );
  for (const m of scanAll(rlsRe, normalized)) {
    const table = identFromGroupsClean(m);
    const mode = m[4]!.toLowerCase();
    if (table) rlsChanges.push(`${mode} RLS on ${table}`);
  }

  const warnings: string[] = [];
  for (const t of drops) {
    warnings.push(`contains DROP TABLE ${t}`);
  }
  if (/\bDROP\s+COLUMN\b/giu.test(normalized)) {
    warnings.push("contains DROP COLUMN");
  }
  if (/\bDROP\s+SCHEMA\b/giu.test(normalized)) {
    warnings.push("contains DROP SCHEMA");
  }
  if (/\bTRUNCATE\b/giu.test(normalized)) {
    warnings.push("contains TRUNCATE");
  }
  if (indexDrops.length > 0) {
    warnings.push(`contains DROP INDEX (${String(indexDrops.length)})`);
  }

  return {
    heuristic: true,
    creates: createTables,
    alters: uniqSorted(alters),
    drops,
    indexCreates,
    indexDrops,
    policyChanges: uniqSorted(policyChanges),
    rlsChanges: uniqSorted(rlsChanges),
    warnings: uniqSorted(warnings),
    hasDestructive: warnings.length > 0,
  };
}

/** CLI/dashboard lines summarizing a migration file (indented body lines). */
export function formatDdlSummaryLines(summary: DdlMigrationSummary): string[] {
  const lines: string[] = [];
  if (summary.creates.length > 0) {
    lines.push("Creates:");
    for (const t of summary.creates) lines.push(`- ${t}`);
  }
  if (summary.alters.length > 0) {
    lines.push("Alters:");
    for (const t of summary.alters) lines.push(`- ${t}`);
  }
  if (summary.indexCreates.length > 0) {
    lines.push("Indexes:");
    for (const t of summary.indexCreates) lines.push(`- create ${t}`);
  }
  if (summary.policyChanges.length > 0) {
    lines.push("Policies:");
    for (const t of summary.policyChanges) lines.push(`- ${t}`);
  }
  if (summary.rlsChanges.length > 0) {
    lines.push("RLS:");
    for (const t of summary.rlsChanges) lines.push(`- ${t}`);
  }
  if (summary.warnings.length > 0) {
    lines.push("Warning:");
    for (const w of summary.warnings) lines.push(`- ${w}`);
  }
  if (lines.length === 0) {
    lines.push(`No obvious DDL patterns detected ${HEURISTIC_LABEL}`);
  }
  return lines;
}

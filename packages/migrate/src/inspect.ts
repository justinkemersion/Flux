import type { MigrationPlan, MigrationPreflight, TableRowCount } from "./types.ts";

function qIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function schemaCommentSql(schemaName: string): string {
  const esc = schemaName.replace(/'/g, "''");
  return `
SELECT obj_description(
  quote_ident('${esc}')::regnamespace,
  'pg_namespace'
) AS comment;
`.trim();
}

export async function loadPreflight(
  query: (sql: string) => Promise<Record<string, unknown>[]>,
  plan: MigrationPlan,
): Promise<MigrationPreflight> {
  const schemaLit = plan.tenantSchema.replace(/'/g, "''");
  const commentRows = await query(
    `SELECT obj_description(quote_ident('${schemaLit}')::regnamespace, 'pg_namespace') AS comment`,
  );
  const rawComment = commentRows[0]?.comment;
  const schemaComment =
    rawComment == null ? null : String(rawComment);

  const tables = await query(
    `
    SELECT tablename AS table
    FROM pg_tables
    WHERE schemaname = '${schemaLit}'
    ORDER BY tablename
    `,
  );

  const counts: TableRowCount[] = [];
  for (const row of tables) {
    const t = row.table;
    if (typeof t !== "string") continue;
    const nRows = await query(
      `SELECT count(*)::text AS n FROM ${qIdent(plan.tenantSchema)}.${qIdent(t)}`,
    );
    const n = nRows[0]?.n;
    counts.push({ table: t, n: Number.parseInt(String(n ?? "0"), 10) || 0 });
  }

  const extRows = await query(
    `SELECT extname AS name FROM pg_extension ORDER BY extname`,
  );
  const extensions = extRows
    .map((r) => r.name)
    .filter((x): x is string => typeof x === "string");

  return { schemaComment, tableCounts: counts, extensions };
}

export function assertSchemaOwnershipComment(
  plan: MigrationPlan,
  preflight: MigrationPreflight,
): void {
  const expected = `tenant:${plan.projectId}`;
  if (preflight.schemaComment !== expected) {
    throw new Error(
      `Schema comment mismatch: expected "${expected}", got ${JSON.stringify(preflight.schemaComment)}`,
    );
  }
}

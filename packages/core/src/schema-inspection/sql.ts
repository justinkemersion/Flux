import { assertFluxApiSchemaIdentifier } from "../api-schema-strategy.ts";

function sqlSchemaLiteral(schema: string): string {
  assertFluxApiSchemaIdentifier(schema);
  return schema.replace(/'/g, "''");
}

export function buildTablesMetaSql(schema: string): string {
  const lit = sqlSchemaLiteral(schema);
  return `
SELECT
  t.table_name,
  COALESCE(c.reltuples, 0)::bigint AS estimated_rows,
  COALESCE(c.relrowsecurity, false) AS rls_enabled,
  COALESCE(c.relforcerowsecurity, false) AS rls_forced,
  (SELECT count(*)::int FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid) AS policy_count
FROM information_schema.tables t
JOIN pg_catalog.pg_class c ON c.relname = t.table_name
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema
WHERE t.table_schema = '${lit}'
  AND t.table_type = 'BASE TABLE'
ORDER BY t.table_name
`.trim();
}

export function buildColumnsSql(schema: string): string {
  const lit = sqlSchemaLiteral(schema);
  return `
SELECT
  cols.table_name,
  cols.column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  cols.is_nullable,
  cols.column_default
FROM information_schema.columns cols
JOIN pg_catalog.pg_class cls ON cls.relname = cols.table_name
JOIN pg_catalog.pg_namespace nsp ON nsp.oid = cls.relnamespace AND nsp.nspname = cols.table_schema
JOIN pg_catalog.pg_attribute a
  ON a.attrelid = cls.oid
 AND a.attname = cols.column_name
 AND a.attnum > 0
 AND NOT a.attisdropped
WHERE cols.table_schema = '${lit}'
ORDER BY cols.table_name, cols.ordinal_position
`.trim();
}

export function buildPrimaryKeysSql(schema: string): string {
  const lit = sqlSchemaLiteral(schema);
  return `
SELECT
  tc.table_name,
  kcu.column_name,
  kcu.ordinal_position
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
WHERE tc.table_schema = '${lit}'
  AND tc.constraint_type = 'PRIMARY KEY'
ORDER BY tc.table_name, kcu.ordinal_position
`.trim();
}

export function buildForeignKeysSql(schema: string): string {
  const lit = sqlSchemaLiteral(schema);
  return `
SELECT
  tc.constraint_name,
  tc.table_name AS from_table,
  kcu.column_name AS from_column,
  ccu.table_name AS to_table,
  ccu.column_name AS to_column,
  rc.delete_rule,
  rc.update_rule,
  kcu.ordinal_position
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
 AND ccu.constraint_schema = tc.table_schema
JOIN information_schema.referential_constraints rc
  ON rc.constraint_name = tc.constraint_name
 AND rc.constraint_schema = tc.table_schema
WHERE tc.table_schema = '${lit}'
  AND tc.constraint_type = 'FOREIGN KEY'
ORDER BY tc.constraint_name, kcu.ordinal_position
`.trim();
}

export function buildGrantsSql(schema: string): string {
  const lit = sqlSchemaLiteral(schema);
  return `
SELECT
  table_name,
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = '${lit}'
ORDER BY table_name, grantee, privilege_type
`.trim();
}

export function buildIndexesSql(schema: string): string {
  const lit = sqlSchemaLiteral(schema);
  return `
SELECT
  t.relname AS table_name,
  i.relname AS index_name,
  array_agg(a.attname ORDER BY k.n) AS column_names
FROM pg_catalog.pg_class t
JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
JOIN pg_catalog.pg_index ix ON t.oid = ix.indrelid
JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, n) ON k.attnum > 0
JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
WHERE n.nspname = '${lit}'
  AND t.relkind IN ('r', 'p')
GROUP BY t.relname, i.relname
ORDER BY t.relname, i.relname
`.trim();
}

/** Safe quoted identifiers — table names come from catalog rows only. */
export function buildExactRowCountSql(schema: string, tableName: string): string {
  assertFluxApiSchemaIdentifier(schema);
  assertFluxApiSchemaIdentifier(tableName);
  const schemaQ = `"${schema.replace(/"/g, '""')}"`;
  const tableQ = `"${tableName.replace(/"/g, '""')}"`;
  return `SELECT count(*)::bigint AS exact_rows FROM ${schemaQ}.${tableQ}`;
}

/**
 * Builds a bounded SELECT for row preview. Both identifiers are validated
 * against the catalog name pattern before use. The LIMIT is enforced
 * server-side — callers must not allow user-supplied limit values.
 *
 * Rows are ordered by the first primary key column if provided, else by
 * system insertion order (no guarantee). This is stable enough for a
 * preview view and avoids expensive sorts on large tables.
 */
export function buildPreviewRowsSql(
  schema: string,
  tableName: string,
  limit: number,
  primaryKeys: readonly string[] = [],
): string {
  assertFluxApiSchemaIdentifier(schema);
  assertFluxApiSchemaIdentifier(tableName);
  const schemaQ = `"${schema.replace(/"/g, '""')}"`;
  const tableQ = `"${tableName.replace(/"/g, '""')}"`;
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 200);
  const orderClause =
    primaryKeys.length > 0
      ? `ORDER BY ${primaryKeys
          .slice(0, 2)
          .map((pk) => {
            assertFluxApiSchemaIdentifier(pk);
            return `"${pk.replace(/"/g, '""')}"`;
          })
          .join(", ")}`
      : "";
  return `SELECT * FROM ${schemaQ}.${tableQ} ${orderClause} LIMIT ${String(safeLimit)}`.trim();
}

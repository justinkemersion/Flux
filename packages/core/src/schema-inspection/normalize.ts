import type {
  InspectedColumn,
  InspectedForeignKey,
  InspectedGrant,
  InspectedRelationship,
  InspectedTable,
  RawColumnRow,
  RawForeignKeyRow,
  RawGrantRow,
  RawIndexRow,
  RawPrimaryKeyRow,
  RawTableMetaRow,
  SchemaInspectionSummary,
} from "./types.ts";

function asBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === "t" || value === "true" || value === "1") return true;
  return false;
}

function asNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function asString(value: unknown): string {
  return String(value ?? "");
}

/**
 * Deduplicate while preserving first-seen order.
 *
 * `information_schema` composite foreign keys produce a cartesian product
 * between `key_column_usage` and `constraint_column_usage` (N columns -> N*N
 * rows), which surfaces as repeated column names (e.g. `a, a, b, b`). A foreign
 * key can never reference the same column twice, so collapsing duplicates is
 * always safe and yields the true ordered column list for every consumer
 * (CLI, dashboard, MCP, warnings).
 */
function dedupePreserveOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function parseIndexColumns(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const inner = trimmed.slice(1, -1);
      if (!inner) return [];
      return inner.split(",").map((part) => part.trim().replace(/^"|"$/g, ""));
    }
  }
  return [];
}

export function normalizeInspectionRows(input: {
  schema: string;
  tableMeta: RawTableMetaRow[];
  columns: RawColumnRow[];
  primaryKeys: RawPrimaryKeyRow[];
  foreignKeys: RawForeignKeyRow[];
  grants: RawGrantRow[];
  indexes: RawIndexRow[];
  exactRowCounts?: Record<string, number>;
}): { tables: InspectedTable[]; relationships: InspectedRelationship[] } {
  const pkByTable = new Map<string, string[]>();
  for (const row of input.primaryKeys) {
    const table = asString(row.table_name);
    const list = pkByTable.get(table) ?? [];
    list.push(asString(row.column_name));
    pkByTable.set(table, list);
  }

  const fkGroups = new Map<string, RawForeignKeyRow[]>();
  for (const row of input.foreignKeys) {
    const key = asString(row.constraint_name);
    const list = fkGroups.get(key) ?? [];
    list.push(row);
    fkGroups.set(key, list);
  }

  const fkByTable = new Map<string, InspectedForeignKey[]>();
  const relationships: InspectedRelationship[] = [];

  for (const [constraintName, rows] of fkGroups) {
    const sorted = [...rows].sort(
      (a, b) =>
        (asNumber(a.ordinal_position) ?? 0) - (asNumber(b.ordinal_position) ?? 0),
    );
    const fromTable = asString(sorted[0]?.from_table);
    const toTable = asString(sorted[0]?.to_table);
    const fromColumns = dedupePreserveOrder(
      sorted.map((r) => asString(r.from_column)),
    );
    const toColumns = dedupePreserveOrder(
      sorted.map((r) => asString(r.to_column)),
    );
    const fk: InspectedForeignKey = {
      constraintName,
      columns: fromColumns,
      referencedTable: toTable,
      referencedColumns: toColumns,
      ...(asString(sorted[0]?.delete_rule)
        ? { onDelete: asString(sorted[0]?.delete_rule) }
        : {}),
      ...(asString(sorted[0]?.update_rule)
        ? { onUpdate: asString(sorted[0]?.update_rule) }
        : {}),
    };
    const tableFks = fkByTable.get(fromTable) ?? [];
    tableFks.push(fk);
    fkByTable.set(fromTable, tableFks);
    relationships.push({
      fromTable,
      fromColumns,
      toTable,
      toColumns,
      constraintName,
      ...(fk.onDelete ? { onDelete: fk.onDelete } : {}),
      ...(fk.onUpdate ? { onUpdate: fk.onUpdate } : {}),
    });
  }

  const grantsByTable = new Map<string, InspectedGrant[]>();
  for (const row of input.grants) {
    const table = asString(row.table_name);
    const list = grantsByTable.get(table) ?? [];
    list.push({
      grantee: asString(row.grantee),
      privilege: asString(row.privilege_type),
    });
    grantsByTable.set(table, list);
  }

  const fkColumnSetByTable = new Map<string, Set<string>>();
  for (const rel of relationships) {
    for (const col of rel.fromColumns) {
      const set = fkColumnSetByTable.get(rel.fromTable) ?? new Set<string>();
      set.add(col);
      fkColumnSetByTable.set(rel.fromTable, set);
    }
  }

  const columnsByTable = new Map<string, InspectedColumn[]>();
  for (const row of input.columns) {
    const table = asString(row.table_name);
    const pk = pkByTable.get(table) ?? [];
    const fkCols = fkColumnSetByTable.get(table) ?? new Set<string>();
    const colName = asString(row.column_name);
    const list = columnsByTable.get(table) ?? [];
    list.push({
      name: colName,
      type: asString(row.data_type),
      nullable: asString(row.is_nullable).toUpperCase() === "YES",
      defaultValue: row.column_default,
      isPrimaryKey: pk.includes(colName),
      isForeignKey: fkCols.has(colName),
    });
    columnsByTable.set(table, list);
  }

  const tables: InspectedTable[] = input.tableMeta.map((meta) => {
    const name = asString(meta.table_name);
    const estimated = input.exactRowCounts?.[name] ?? asNumber(meta.estimated_rows);
    return {
      schema: input.schema,
      name,
      ...(estimated !== undefined ? { estimatedRows: estimated } : {}),
      columns: columnsByTable.get(name) ?? [],
      primaryKey: pkByTable.get(name) ?? [],
      foreignKeys: fkByTable.get(name) ?? [],
      rls: {
        enabled: asBool(meta.rls_enabled),
        forced: asBool(meta.rls_forced),
      },
      ...(grantsByTable.has(name)
        ? { grants: grantsByTable.get(name)! }
        : {}),
    };
  });

  return { tables, relationships };
}

export function buildSchemaInspectionSummary(input: {
  tables: InspectedTable[];
  relationships: InspectedRelationship[];
}): SchemaInspectionSummary {
  const columnCount = input.tables.reduce(
    (sum, table) => sum + table.columns.length,
    0,
  );
  return {
    tableCount: input.tables.length,
    columnCount,
    relationshipCount: input.relationships.length,
    tablesWithoutPrimaryKey: input.tables.filter((t) => t.primaryKey.length === 0)
      .length,
    tablesWithRlsEnabled: input.tables.filter((t) => t.rls.enabled).length,
    tablesWithRlsDisabled: input.tables.filter((t) => !t.rls.enabled).length,
  };
}

export function indexColumnsByTable(
  indexes: RawIndexRow[],
): Map<string, string[][]> {
  const byTable = new Map<string, string[][]>();
  for (const row of indexes) {
    const table = asString(row.table_name);
    const cols = parseIndexColumns(row.column_names);
    const list = byTable.get(table) ?? [];
    list.push(cols);
    byTable.set(table, list);
  }
  return byTable;
}

export const MAX_SCHEMA_INSPECTION_JSON_BYTES = 512 * 1024;

export function assertSchemaInspectionPayloadSize(result: unknown): void {
  const bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  if (bytes > MAX_SCHEMA_INSPECTION_JSON_BYTES) {
    throw new Error(
      `Schema inspection payload exceeds ${String(MAX_SCHEMA_INSPECTION_JSON_BYTES)} bytes`,
    );
  }
}

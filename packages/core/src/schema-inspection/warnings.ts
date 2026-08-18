import type {
  InspectedRelationship,
  InspectedTable,
  SchemaWarning,
  SchemaWarningCode,
} from "./types.ts";

const WIDE_TABLE_COLUMN_THRESHOLD = 25;

function warning(
  code: SchemaWarningCode,
  severity: SchemaWarning["severity"],
  message: string,
  extra?: Pick<SchemaWarning, "table" | "column" | "details">,
): SchemaWarning {
  return {
    code,
    severity,
    message,
    ...(extra?.table ? { table: extra.table } : {}),
    ...(extra?.column ? { column: extra.column } : {}),
    ...(extra?.details ? { details: extra.details } : {}),
  };
}

function fkHasSupportingIndex(
  fk: InspectedRelationship,
  indexMap: Map<string, string[][]>,
): boolean {
  const indexes = indexMap.get(fk.fromTable) ?? [];
  return indexes.some((cols) =>
    fk.fromColumns.every((col, idx) => cols[idx] === col),
  );
}

export function generateSchemaWarnings(input: {
  tables: InspectedTable[];
  relationships: InspectedRelationship[];
  indexMap: Map<string, string[][]>;
}): SchemaWarning[] {
  const warnings: SchemaWarning[] = [];

  if (input.tables.length === 0) {
    warnings.push(
      warning(
        "empty_schema",
        "warning",
        "No user tables found in the API schema",
      ),
    );
    return warnings;
  }

  for (const table of input.tables) {
    if (table.primaryKey.length === 0) {
      warnings.push(
        warning(
          "table_without_primary_key",
          "warning",
          `Table ${table.name} has no primary key`,
          { table: table.name },
        ),
      );
    }

    if (!table.rls.enabled) {
      warnings.push(
        warning(
          "rls_disabled",
          "warning",
          `Row level security is disabled on ${table.name}`,
          { table: table.name },
        ),
      );
    } else if (table.rls.policyCount === 0) {
      warnings.push(
        warning(
          "rls_enabled_without_policies",
          "warning",
          `Row level security is enabled on ${table.name}, but the table has no policies`,
          { table: table.name },
        ),
      );
    }

    if (table.columns.length > WIDE_TABLE_COLUMN_THRESHOLD) {
      warnings.push(
        warning(
          "wide_table",
          "info",
          `Table ${table.name} has ${String(table.columns.length)} columns`,
          {
            table: table.name,
            details: { columnCount: table.columns.length },
          },
        ),
      );
    }
  }

  for (const rel of input.relationships) {
    if (!fkHasSupportingIndex(rel, input.indexMap)) {
      warnings.push(
        warning(
          "foreign_key_without_index",
          "warning",
          `Foreign key ${rel.constraintName} on ${rel.fromTable}(${rel.fromColumns.join(", ")}) lacks a supporting index`,
          {
            table: rel.fromTable,
            details: {
              constraintName: rel.constraintName,
              columns: rel.fromColumns,
            },
          },
        ),
      );
    }

    const table = input.tables.find((t) => t.name === rel.fromTable);
    if (!table) continue;
    for (const colName of rel.fromColumns) {
      const col = table.columns.find((c) => c.name === colName);
      if (col?.nullable) {
        warnings.push(
          warning(
            "nullable_foreign_key",
            "info",
            `Nullable foreign key column ${rel.fromTable}.${colName} (${rel.constraintName})`,
            {
              table: rel.fromTable,
              column: colName,
              details: { constraintName: rel.constraintName },
            },
          ),
        );
      }
    }
  }

  return warnings;
}

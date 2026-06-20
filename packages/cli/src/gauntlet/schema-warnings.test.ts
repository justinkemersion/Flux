import assert from "node:assert/strict";
import test from "node:test";
import { indexColumnsByTable } from "@flux/core/schema-inspection";
import { generateSchemaWarnings } from "@flux/core/schema-inspection";
import type { InspectedRelationship, InspectedTable } from "@flux/core/schema-inspection";

function baseTable(name: string, columnCount: number, pk: string[]): InspectedTable {
  const columns = Array.from({ length: columnCount }, (_, i) => ({
    name: `col_${String(i + 1)}`,
    type: "text",
    nullable: false,
  }));
  return {
    schema: "api",
    name,
    columns,
    primaryKey: pk,
    foreignKeys: [],
    rls: { enabled: true },
  };
}

test("generateSchemaWarnings flags wide_table", () => {
  const warnings = generateSchemaWarnings({
    tables: [baseTable("wide", 26, ["col_1"])],
    relationships: [],
    indexMap: new Map(),
  });
  assert.equal(warnings.some((w) => w.code === "wide_table"), true);
});

test("generateSchemaWarnings respects supporting index on FK", () => {
  const relationships: InspectedRelationship[] = [
    {
      fromTable: "events",
      fromColumns: ["note_id"],
      toTable: "notes",
      toColumns: ["id"],
      constraintName: "events_note_id_fkey",
    },
  ];
  const warnings = generateSchemaWarnings({
    tables: [
      baseTable("notes", 2, ["col_1"]),
      baseTable("events", 3, ["col_1"]),
    ],
    relationships,
    indexMap: indexColumnsByTable([
      {
        table_name: "events",
        index_name: "events_pkey",
        column_names: ["col_1"],
      },
      {
        table_name: "events",
        index_name: "events_note_id_idx",
        column_names: ["note_id"],
      },
    ]),
  });
  assert.equal(
    warnings.some((w) => w.code === "foreign_key_without_index"),
    false,
  );
});

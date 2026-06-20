import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSchemaInspectionSummary,
  indexColumnsByTable,
  normalizeInspectionRows,
} from "@flux/core/schema-inspection";
import {
  buildSchemaGraph,
  buildSchemaInspectionMarkdownSection,
} from "./schema-story-report";
import type {
  InspectedRelationship,
  InspectedTable,
  RawColumnRow,
  RawForeignKeyRow,
  RawIndexRow,
  RawPrimaryKeyRow,
  RawTableMetaRow,
} from "@flux/core/schema-inspection";
import { generateSchemaWarnings } from "@flux/core/schema-inspection";

const gauntletTablesMeta: RawTableMetaRow[] = [
  {
    table_name: "gauntlet_notes",
    estimated_rows: 1,
    rls_enabled: false,
    rls_forced: false,
  },
  {
    table_name: "gauntlet_events",
    estimated_rows: 1,
    rls_enabled: false,
    rls_forced: false,
  },
];

const gauntletColumns: RawColumnRow[] = [
  {
    table_name: "gauntlet_notes",
    column_name: "id",
    data_type: "bigint",
    is_nullable: "NO",
    column_default: null,
  },
  {
    table_name: "gauntlet_notes",
    column_name: "title",
    data_type: "text",
    is_nullable: "NO",
    column_default: null,
  },
  {
    table_name: "gauntlet_events",
    column_name: "id",
    data_type: "bigint",
    is_nullable: "NO",
    column_default: null,
  },
  {
    table_name: "gauntlet_events",
    column_name: "note_id",
    data_type: "bigint",
    is_nullable: "NO",
    column_default: null,
  },
];

const gauntletPrimaryKeys: RawPrimaryKeyRow[] = [
  { table_name: "gauntlet_notes", column_name: "id", ordinal_position: 1 },
  { table_name: "gauntlet_events", column_name: "id", ordinal_position: 1 },
];

const gauntletForeignKeys: RawForeignKeyRow[] = [
  {
    constraint_name: "gauntlet_events_note_id_fkey",
    from_table: "gauntlet_events",
    from_column: "note_id",
    to_table: "gauntlet_notes",
    to_column: "id",
    delete_rule: "CASCADE",
    update_rule: "NO ACTION",
    ordinal_position: 1,
  },
];

test("normalizeInspectionRows builds stable table and relationship objects", () => {
  const { tables, relationships } = normalizeInspectionRows({
    schema: "api",
    tableMeta: gauntletTablesMeta,
    columns: gauntletColumns,
    primaryKeys: gauntletPrimaryKeys,
    foreignKeys: gauntletForeignKeys,
    grants: [],
    indexes: [],
    exactRowCounts: { gauntlet_notes: 2, gauntlet_events: 3 },
  });

  assert.equal(tables.length, 2);
  assert.equal(relationships.length, 1);
  assert.deepEqual(tables[0]?.primaryKey, ["id"]);
  assert.equal(tables[0]?.estimatedRows, 2);
  assert.equal(tables[1]?.columns.find((c) => c.name === "note_id")?.isForeignKey, true);
  assert.equal(relationships[0]?.constraintName, "gauntlet_events_note_id_fkey");
});

test("buildSchemaGraph produces nodes and edges", () => {
  const { tables, relationships } = normalizeInspectionRows({
    schema: "api",
    tableMeta: gauntletTablesMeta,
    columns: gauntletColumns,
    primaryKeys: gauntletPrimaryKeys,
    foreignKeys: gauntletForeignKeys,
    grants: [],
    indexes: [],
  });
  const graph = buildSchemaGraph({ tables, relationships });
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0]?.from, "gauntlet_events");
  assert.equal(graph.edges[0]?.to, "gauntlet_notes");
});

test("buildSchemaInspectionSummary aggregates counts", () => {
  const { tables, relationships } = normalizeInspectionRows({
    schema: "api",
    tableMeta: gauntletTablesMeta,
    columns: gauntletColumns,
    primaryKeys: gauntletPrimaryKeys,
    foreignKeys: gauntletForeignKeys,
    grants: [],
    indexes: [],
  });
  const summary = buildSchemaInspectionSummary({ tables, relationships });
  assert.equal(summary.tableCount, 2);
  assert.equal(summary.columnCount, 4);
  assert.equal(summary.relationshipCount, 1);
  assert.equal(summary.tablesWithRlsDisabled, 2);
});

test("buildSchemaInspectionMarkdownSection renders compact summary", () => {
  const { tables, relationships } = normalizeInspectionRows({
    schema: "api",
    tableMeta: gauntletTablesMeta,
    columns: gauntletColumns,
    primaryKeys: gauntletPrimaryKeys,
    foreignKeys: gauntletForeignKeys,
    grants: [],
    indexes: [],
  });
  const warnings = generateSchemaWarnings({
    tables,
    relationships,
    indexMap: indexColumnsByTable([]),
  });
  const md = buildSchemaInspectionMarkdownSection({
    mode: "v1_dedicated",
    project: { slug: "gauntlet-test", schema: "api" },
    inspectedAt: "2026-06-20T00:00:00.000Z",
    tables,
    relationships,
    warnings,
    summary: buildSchemaInspectionSummary({ tables, relationships }),
  });
  assert.match(md, /## Schema Inspection/u);
  assert.match(md, /Tables: 2/u);
  assert.match(md, /rls_disabled/u);
});

function table(name: string, columns: InspectedTable["columns"], pk: string[]): InspectedTable {
  return {
    schema: "api",
    name,
    columns,
    primaryKey: pk,
    foreignKeys: [],
    rls: { enabled: false },
  };
}

test("generateSchemaWarnings flags empty schema", () => {
  const warnings = generateSchemaWarnings({
    tables: [],
    relationships: [],
    indexMap: new Map(),
  });
  assert.equal(warnings.some((w) => w.code === "empty_schema"), true);
});

test("generateSchemaWarnings flags table without primary key", () => {
  const warnings = generateSchemaWarnings({
    tables: [table("orphan", [{ name: "id", type: "bigint", nullable: false }], [])],
    relationships: [],
    indexMap: new Map(),
  });
  assert.equal(
    warnings.some((w) => w.code === "table_without_primary_key"),
    true,
  );
});

test("generateSchemaWarnings flags foreign key without index", () => {
  const relationships: InspectedRelationship[] = [
    {
      fromTable: "child",
      fromColumns: ["parent_id"],
      toTable: "parent",
      toColumns: ["id"],
      constraintName: "child_parent_id_fkey",
    },
  ];
  const warnings = generateSchemaWarnings({
    tables: [
      table("parent", [{ name: "id", type: "bigint", nullable: false }], ["id"]),
      table(
        "child",
        [
          { name: "id", type: "bigint", nullable: false },
          { name: "parent_id", type: "bigint", nullable: false, isForeignKey: true },
        ],
        ["id"],
      ),
    ],
    relationships,
    indexMap: new Map(),
  });
  assert.equal(
    warnings.some((w) => w.code === "foreign_key_without_index"),
    true,
  );
});

test("generateSchemaWarnings flags nullable foreign key", () => {
  const relationships: InspectedRelationship[] = [
    {
      fromTable: "child",
      fromColumns: ["parent_id"],
      toTable: "parent",
      toColumns: ["id"],
      constraintName: "child_parent_id_fkey",
    },
  ];
  const indexes: RawIndexRow[] = [
    {
      table_name: "child",
      index_name: "child_parent_id_idx",
      column_names: ["parent_id"],
    },
  ];
  const warnings = generateSchemaWarnings({
    tables: [
      table("parent", [{ name: "id", type: "bigint", nullable: false }], ["id"]),
      table(
        "child",
        [
          { name: "id", type: "bigint", nullable: false },
          {
            name: "parent_id",
            type: "bigint",
            nullable: true,
            isForeignKey: true,
          },
        ],
        ["id"],
      ),
    ],
    relationships,
    indexMap: indexColumnsByTable(indexes),
  });
  assert.equal(
    warnings.some((w) => w.code === "nullable_foreign_key"),
    true,
  );
});

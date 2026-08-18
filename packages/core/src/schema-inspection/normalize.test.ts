import test from "node:test";
import assert from "node:assert/strict";
import { normalizeInspectionRows } from "./normalize.ts";
import { generateSchemaWarnings } from "./warnings.ts";
import type { RawForeignKeyRow } from "./types.ts";

/**
 * information_schema produces a cartesian product for composite foreign keys:
 * a 2-column FK yields 4 rows (each from_column paired with each to_column),
 * which previously surfaced as `a, a, b, b` in warning output.
 */
const COMPOSITE_FK_ROWS: RawForeignKeyRow[] = [
  {
    constraint_name: "atelier_images_profile_match_fkey",
    from_table: "atelier_images",
    from_column: "atelier_id",
    to_table: "profiles",
    to_column: "atelier_id",
    delete_rule: "NO ACTION",
    update_rule: "NO ACTION",
    ordinal_position: 1,
  },
  {
    constraint_name: "atelier_images_profile_match_fkey",
    from_table: "atelier_images",
    from_column: "atelier_id",
    to_table: "profiles",
    to_column: "maker_auth_id",
    delete_rule: "NO ACTION",
    update_rule: "NO ACTION",
    ordinal_position: 1,
  },
  {
    constraint_name: "atelier_images_profile_match_fkey",
    from_table: "atelier_images",
    from_column: "maker_auth_id",
    to_table: "profiles",
    to_column: "atelier_id",
    delete_rule: "NO ACTION",
    update_rule: "NO ACTION",
    ordinal_position: 2,
  },
  {
    constraint_name: "atelier_images_profile_match_fkey",
    from_table: "atelier_images",
    from_column: "maker_auth_id",
    to_table: "profiles",
    to_column: "maker_auth_id",
    delete_rule: "NO ACTION",
    update_rule: "NO ACTION",
    ordinal_position: 2,
  },
];

function normalizeFkOnly() {
  return normalizeInspectionRows({
    schema: "t_abc123_api",
    tableMeta: [
      {
        table_name: "atelier_images",
        estimated_rows: 46,
        rls_enabled: true,
        rls_forced: false,
        policy_count: 1,
      },
    ],
    columns: [],
    primaryKeys: [],
    foreignKeys: COMPOSITE_FK_ROWS,
    grants: [],
    indexes: [],
  });
}

test("normalizeInspectionRows deduplicates composite FK columns in stable order", () => {
  const { relationships, tables } = normalizeFkOnly();
  assert.equal(relationships.length, 1);
  assert.deepEqual(relationships[0]!.fromColumns, ["atelier_id", "maker_auth_id"]);
  assert.deepEqual(relationships[0]!.toColumns, ["atelier_id", "maker_auth_id"]);

  const fk = tables[0]!.foreignKeys[0]!;
  assert.deepEqual(fk.columns, ["atelier_id", "maker_auth_id"]);
  assert.deepEqual(fk.referencedColumns, ["atelier_id", "maker_auth_id"]);
});

test("foreign_key_without_index warning lists each column once", () => {
  const { tables, relationships } = normalizeFkOnly();
  const warnings = generateSchemaWarnings({
    tables,
    relationships,
    indexMap: new Map(),
  });

  const fkWarning = warnings.find((w) => w.code === "foreign_key_without_index");
  assert.ok(fkWarning, "expected a foreign_key_without_index warning");
  assert.match(fkWarning.message, /atelier_images\(atelier_id, maker_auth_id\)/);
  assert.equal(fkWarning.message.includes("atelier_id, atelier_id"), false);

  const cols = (fkWarning.details as { columns: string[] }).columns;
  assert.deepEqual(cols, ["atelier_id", "maker_auth_id"]);
});

test("RLS enabled without policies is visible as a distinct warning", () => {
  const { tables, relationships } = normalizeInspectionRows({
    schema: "api",
    tableMeta: [
      {
        table_name: "locked_notes",
        estimated_rows: 0,
        rls_enabled: true,
        rls_forced: false,
        policy_count: 0,
      },
    ],
    columns: [],
    primaryKeys: [],
    foreignKeys: [],
    grants: [],
    indexes: [],
  });
  const warnings = generateSchemaWarnings({
    tables,
    relationships,
    indexMap: new Map(),
  });

  assert.ok(warnings.some((w) => w.code === "rls_enabled_without_policies"));
});

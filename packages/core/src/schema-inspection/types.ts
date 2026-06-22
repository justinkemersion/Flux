export type SchemaInspectionMode = "v1_dedicated" | "v2_shared";

export type SchemaWarningSeverity = "info" | "warning" | "danger";

export type SchemaWarningCode =
  | "table_without_primary_key"
  | "foreign_key_without_index"
  | "rls_disabled"
  | "empty_schema"
  | "wide_table"
  | "nullable_foreign_key";

export interface SchemaWarning {
  code: SchemaWarningCode;
  severity: SchemaWarningSeverity;
  message: string;
  table?: string;
  column?: string;
  details?: Record<string, unknown>;
}

export interface InspectedGrant {
  grantee: string;
  privilege: string;
}

export interface InspectedColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string | null;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
}

export interface InspectedForeignKey {
  constraintName: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDelete?: string;
  onUpdate?: string;
}

export interface InspectedTable {
  schema: string;
  name: string;
  estimatedRows?: number;
  columns: InspectedColumn[];
  primaryKey: string[];
  foreignKeys: InspectedForeignKey[];
  rls: {
    enabled: boolean;
    forced?: boolean;
  };
  grants?: InspectedGrant[];
}

export interface InspectedRelationship {
  fromTable: string;
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
  constraintName: string;
  onDelete?: string;
  onUpdate?: string;
}

export interface SchemaInspectionSummary {
  tableCount: number;
  columnCount: number;
  relationshipCount: number;
  tablesWithoutPrimaryKey: number;
  tablesWithRlsEnabled: number;
  tablesWithRlsDisabled: number;
}

export interface SchemaInspectionResult {
  mode: SchemaInspectionMode;
  project: {
    slug: string;
    hash?: string;
    apiUrl?: string;
    schema: string;
  };
  inspectedAt: string;
  tables: InspectedTable[];
  relationships: InspectedRelationship[];
  warnings: SchemaWarning[];
  summary: SchemaInspectionSummary;
}

export interface SchemaGraphNode {
  id: string;
  label: string;
}

export interface SchemaGraphEdge {
  from: string;
  to: string;
  label: string;
  constraintName?: string;
}

export interface SchemaGraph {
  nodes: SchemaGraphNode[];
  edges: SchemaGraphEdge[];
}

export interface RawTableMetaRow {
  table_name: string;
  estimated_rows: number | string | null;
  rls_enabled: boolean | string;
  rls_forced: boolean | string;
}

export interface RawColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

export interface RawPrimaryKeyRow {
  table_name: string;
  column_name: string;
  ordinal_position: number | string;
}

export interface RawForeignKeyRow {
  constraint_name: string;
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
  delete_rule: string;
  update_rule: string;
  ordinal_position: number | string;
}

export interface RawGrantRow {
  table_name: string;
  grantee: string;
  privilege_type: string;
}

export interface RawIndexRow {
  table_name: string;
  index_name: string;
  column_names: string[] | string;
}

export class SchemaInspectionUnsupportedError extends Error {
  readonly mode: SchemaInspectionMode;

  constructor(mode: SchemaInspectionMode) {
    super(`Schema inspection is not available for mode: ${mode}.`);
    this.name = "SchemaInspectionUnsupportedError";
    this.mode = mode;
  }
}

export interface InspectTenantSchemaOptions {
  slug: string;
  hash: string;
  apiSchema: string;
  apiUrl?: string;
  /**
   * Engine mode for the result payload. Defaults to "v1_dedicated" when omitted
   * so existing callers that do not pass a mode remain unaffected.
   */
  mode?: SchemaInspectionMode;
  /** Default false — exact count(*) only when explicitly enabled. */
  includeExactCounts?: boolean;
}

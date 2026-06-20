export type {
  InspectTenantSchemaOptions,
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
  SchemaGraph,
  SchemaGraphEdge,
  SchemaGraphNode,
  SchemaInspectionMode,
  SchemaInspectionResult,
  SchemaInspectionSummary,
  SchemaWarning,
  SchemaWarningCode,
  SchemaWarningSeverity,
} from "./types.ts";

export { SchemaInspectionUnsupportedError } from "./types.ts";

export {
  buildColumnsSql,
  buildExactRowCountSql,
  buildForeignKeysSql,
  buildGrantsSql,
  buildIndexesSql,
  buildPrimaryKeysSql,
  buildTablesMetaSql,
} from "./sql.ts";

export {
  assertSchemaInspectionPayloadSize,
  buildSchemaInspectionSummary,
  indexColumnsByTable,
  MAX_SCHEMA_INSPECTION_JSON_BYTES,
  normalizeInspectionRows,
} from "./normalize.ts";

export { generateSchemaWarnings } from "./warnings.ts";

export {
  createTenantCatalogQueryFn,
  inspectTenantSchema,
  type TenantCatalogQueryFn,
} from "./inspect.ts";

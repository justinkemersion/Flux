export type {
  MigrateApiResult,
  MigrateCliPayload,
  MigrationPhase,
  MigrationPlan,
  MigrationPreflight,
  TableRowCount,
} from "./types.ts";
export {
  buildMigrationPlanFromCatalogRow,
  type CatalogProjectLike,
} from "./plan.ts";
export {
  assertSchemaOwnershipComment,
  loadPreflight,
  schemaCommentSql,
} from "./inspect.ts";
export { pgDumpTenantSchemaToFile } from "./dump.ts";
export { assertPgDumpOnPath, assertSharedPostgresUrlConfigured } from "./preflight.ts";
export {
  assertSequenceSnapshotsMatch,
  snapshotSequencesInSchema,
  type SequenceSnapshot,
} from "./sequences.ts";

export {
  FLUX_DEFAULT_DOMAIN,
  fluxTenantDomain,
  fluxApiHttpsForTenantUrls,
  fluxTenantPostgrestHostname,
  fluxTenantV1LegacyDottedHostname,
  fluxApiUrlForSlug,
  type FluxCatalogProjectMode,
  fluxTenantV2SharedHostname,
  fluxApiUrlForV2Shared,
  fluxApiUrlForCatalog,
} from "./tenant-catalog-urls.ts";

export type { ImportSqlFileOptions } from "./import-dump.ts";
export type { MovePublicToApiResult } from "./schema-move-public-to-api.ts";
export {
  movePublicSchemaObjectsToTargetSchema,
  movePublicSchemaObjectsToApi,
} from "./schema-move-public-to-api.ts";

export type { ImportSqlFileResult, FluxProjectEnvEntry, FluxProjectSummary } from "./standalone.ts";
export { slugifyProjectName, fluxTenantStatusFromContainerPair } from "./standalone.ts";
export {
  applySupabaseCompatibilityTransforms,
  preparePlainSqlDumpForFlux,
  queryPostgresMajorVersion,
  sanitizePlainSqlDumpForPostgresMajor,
} from "./import-dump.ts";
export {
  FLUX_PUSH_SQL_TARGET_MAJOR,
  normalizePushSql,
} from "./sql-migrations.ts";
export { embedSqlStatement, sqlStatement } from "./sql-compose.ts";
export { queryPsqlJsonRows, queryPsqlScalar } from "./postgres-internal-exec.ts";
export {
  API_SCHEMA_PRIVILEGES_SQL,
  DISABLE_ROW_LEVEL_SECURITY_FOR_RLS_ENABLED_API_TABLES_SQL,
  buildApiSchemaPrivilegesSql,
  buildDisableRowLevelSecurityForSchemaSql,
} from "./api-schema-privileges.ts";
export {
  assertFluxApiSchemaIdentifier,
  defaultTenantApiSchemaFromProjectId,
  defaultTenantDdlRoleFromProjectId,
  defaultTenantRoleFromProjectId,
  deriveTenantSchemaShortId,
  fluxV1TenantSchemaEnabled,
  isTenantSchemaStrategyProject,
  LEGACY_FLUX_API_SCHEMA,
  resolveTenantApiSchemaName,
  resolveV1ProvisionApiSchemaName,
  type ApiSchemaStrategy,
  type ProjectApiSchemaInput,
} from "./api-schema-strategy.ts";
export {
  FLUX_GATEWAY_DRAINING_MIGRATION_STATUS,
  FLUX_SILENT_MIGRATION_MUTEX_STATUS,
  fluxMigrationStatusIsActiveLease,
  type FluxCatalogMigrationStatus,
} from "./migration-status.ts";
export { FLUX_AUTH_SCHEMA_AND_UID_SQL } from "./auth-compat-sql.ts";
export {
  FLUX_PROJECT_HASH_HEX_LEN,
  FLUX_SYSTEM_HASH,
  generateProjectHash,
} from "./tenant-suffix.ts";

export {
  FLUX_DOCKER_IMAGES,
  FLUX_GATEWAY_CONTAINER_NAME,
  FLUX_MANAGED_LABEL,
  FLUX_MANAGED_VALUE,
  FLUX_NETWORK_NAME,
  FLUX_PROJECT_SLUG_LABEL,
  FLUX_PURPOSE_CONTROL_PLANE,
  FLUX_PURPOSE_LABEL,
  FLUX_PURPOSE_TENANT,
  FLUX_TRAEFIK_ACME_RESOLVER,
} from "./docker/docker-constants.ts";

export {
  fluxTenantCpuNanoCpus,
  fluxTenantMemoryLimitBytes,
} from "./docker/docker-resources.ts";

export { tenantVolumeName } from "./docker/docker-names.ts";

export {
  BOOTSTRAP_SQL,
  buildBootstrapSql,
  pgrstDbSchemasEnvValue,
} from "./database/bootstrap-sql.ts";
export { deriveTenantPostgresPasswordFromSecret } from "./database/tenant-postgres-password.ts";
export { isFluxSensitiveEnvKey } from "./runtime/sensitive-env.ts";

export {
  fluxTraefikCertResolverName,
  parseAllowedOriginsList,
  postgrestTraefikDockerLabels,
  serializeAllowedOriginsList,
} from "./traefik/traefik-labels.ts";

export type { ProjectManagerConnectOptions } from "./docker/docker-client.ts";
export {
  assertFluxDockerEngineReachableOrThrow,
  createFluxDocker,
  dockerEngineRequiresStrictReachability,
  formatDockerEngineTarget,
} from "./docker/docker-client.ts";

export type {
  FluxNodeStats,
  ProjectDumpOptions,
  FluxProjectCredentials,
  FluxSystemProjectActivity,
  FluxProject,
  ProvisionOptions,
  NukeProjectOptions,
  DeleteProjectInfrastructureResult,
  FluxProjectSlugRef,
} from "./projects/project-manager.ts";

export { ProjectManager, testDockerConnection } from "./projects/project-manager.ts";
export {
  catalogModeUsesDockerStacks,
  type FluxProjectManagerStackKind,
} from "./projects/runtime-modes.ts";

export {
  redactDatabaseAccessPlan,
  resolveDefaultSshTunnelConfig,
  resolveProjectDatabaseAccess,
  resolveSharedPostgresTunnelTarget,
  type DatabaseAccessCapabilities,
  type DatabaseAccessPlan,
  type DatabaseAccessTransport,
  type DatabaseAccessTunnelDefaults,
  type DedicatedDatabaseAccessPlan,
  type PooledDatabaseAccessPlan,
  type PooledDatabaseAccessPreviewPlan,
  type ResolveProjectDatabaseAccessInput,
  type ResolveProjectDatabaseAccessOptions,
} from "./projects/database-access.ts";

export {
  DATABASE_GUI_LABELS,
  GUI_SSH_TUNNEL_OFF_VALUE,
  V2_GUI_DATABASE_WARNING,
  buildDashboardDatabaseGuiHints,
  buildDatabaseGuiConnectionHints,
  formatAccessPlanGuiSummary,
  formatDatabaseGuiConfigLines,
  listDatabaseGuiConfigFields,
  toDatabaseGuiStructuredFields,
  type BuildDatabaseGuiConnectionHintsOptions,
  type DashboardDatabaseGuiInput,
  type DatabaseGuiConfigField,
  type DatabaseGuiConnectionHints,
  type DatabaseGuiStructuredFields,
} from "./projects/database-access-gui.ts";

export {
  assertPgRoleNameByteLength,
  DB_ACCESS_TTL_DEFAULT_READONLY_SECONDS,
  DB_ACCESS_TTL_DEFAULT_READWRITE_SECONDS,
  DB_ACCESS_TTL_MAX_SECONDS,
  dbAccessReadwriteEnabled,
  fluxTempLoginRoleName,
  fluxTenantGroupRoleName,
  normalizeDbAccessTtlSeconds,
  quotePgIdent,
  sanitizeDbAccessHashSegment,
  sanitizeDbAccessSuffixSegment,
  type DbAccessLevel,
} from "./projects/db-access-roles.ts";

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
  TenantCatalogQueryFn,
} from "./schema-inspection/index.ts";

export {
  SchemaInspectionUnsupportedError,
  assertSchemaInspectionPayloadSize,
  buildColumnsSql,
  buildExactRowCountSql,
  buildForeignKeysSql,
  buildGrantsSql,
  buildIndexesSql,
  buildPrimaryKeysSql,
  buildSchemaInspectionSummary,
  buildTablesMetaSql,
  createTenantCatalogQueryFn,
  generateSchemaWarnings,
  indexColumnsByTable,
  inspectTenantSchema,
  MAX_SCHEMA_INSPECTION_JSON_BYTES,
  normalizeInspectionRows,
} from "./schema-inspection/index.ts";

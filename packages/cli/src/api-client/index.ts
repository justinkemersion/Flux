/**
 * Public entrypoint for the Flux control-plane API client.
 *
 * Exposed as the `@flux/cli/api-client` subpath so internal workspace consumers
 * (e.g. `@flux/mcp`) can reuse the exact same control-plane client + auth/config
 * resolution as the `flux` CLI without duplicating HTTP logic.
 */

export { ApiClient, getApiClient, getMcpApiClient } from "./client";
export { resolveFluxApiToken } from "../config";
export {
  assertValidMcpEnvToken,
  detectTokenFamily,
  isMcpTokenLike,
  isValidMcpTokenFormat,
  legacyMcpTokenWarningForSource,
  LEGACY_MCP_TOKEN_WARNING,
  NO_MCP_TOKEN_WARNING,
  resolveMcpServerToken,
  warningContainsTokenValue,
  isSafeMcpKeyPreview,
  stringContainsMcpTokenMaterial,
} from "./mcp-auth";
export type { McpTokenSource, ResolvedMcpServerToken, TokenFamily } from "./mcp-auth";
export { MCP_CAPABILITIES, MCP_CAPABILITY_PRESETS } from "./mcp-capabilities";
export type { McpCapability } from "./mcp-capabilities";
export { normalizeFluxApiBase } from "./normalize-api-base";
export {
  buildMcpLegacyCliTokenWarning,
  legacyMcpWarningImpliesImmediateRemoval,
  MCP_LEGACY_CLI_TOKEN_DEPRECATION_PREREQUISITES,
  MCP_LEGACY_CLI_TOKEN_FOR_MCP_STATUS,
} from "./mcp-deprecation";
export {
  isCliVerifyResult,
  isMcpVerifyResult,
} from "./schemas";

export type { ApiClientContext } from "./context";
export type { TemporaryDbCredential } from "./db-access";
export type { DatabaseAccessPlan, DbAccessLevel } from "@flux/core/standalone";
export type { DoctorCheck, DoctorCheckStatus, DoctorReport } from "./doctor";
export type { ProjectActivityResponse } from "./activity";
export type { ProjectLifecycleInfo } from "./project-lifecycle-state";
export type {
  CreateProjectMode,
  CreateProjectResult,
  CreateProjectBackupResult,
  InitProjectResult,
  ListProjectBackupsResult,
  ProjectBackup,
  ProjectCredentialsByHash,
  ProjectFluxMdDetail,
  ProjectMetadata,
  ProjectMetadataDetail,
  VerifyBackupResult,
  VerifyTokenResult,
  VerifyTokenCliResult,
  VerifyTokenMcpResult,
} from "./schemas";

export type { PushSqlResult } from "./push";

export type { SchemaInspectionResult } from "@flux/core/schema-inspection";
export type { FluxMigrationRecord } from "@flux/core/sql-migrations";
export type { FluxProjectSummary } from "@flux/core/standalone";
export type { ProjectActivityEvent } from "@flux/core/project-activity";

export type {
  McpAuditDecision,
  McpIntentClass as McpAuditIntentClass,
  McpResultStatus,
  RecordMcpAuditEventInput,
  RecordMcpAuditEventResult,
} from "./mcp-audit";
export type {
  CreateMcpIntentInput,
  CreateMcpIntentResult,
  McpIntentDetail,
  McpIntentStatus,
  McpRiskLevel,
  UpdateMcpIntentInput,
  UpdateMcpIntentResult,
} from "./mcp-intents";

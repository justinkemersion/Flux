/**
 * Public entrypoint for the Flux control-plane API client.
 *
 * Exposed as the `@flux/cli/api-client` subpath so internal workspace consumers
 * (e.g. `@flux/mcp`) can reuse the exact same control-plane client + auth/config
 * resolution as the `flux` CLI without duplicating HTTP logic.
 */

export { ApiClient, getApiClient } from "./client";
export { resolveFluxApiToken } from "../config";

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
} from "./schemas";

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

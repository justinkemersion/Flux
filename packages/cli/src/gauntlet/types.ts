import type { SchemaInspectionResult } from "@flux/core/schema-inspection";
import type { CreateProjectMode } from "../api-client/schemas";
import type { GauntletFailureClass } from "./failure-class";

export type GauntletMode = CreateProjectMode;

export type StageStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "skipped";

export type GauntletStageName =
  | "preflight"
  | "create_project"
  | "wait_for_health"
  | "push_schema"
  | "inspect_schema"
  | "inspect_schema_deep"
  | "api_insert"
  | "api_select"
  | "backup_create"
  | "backup_verify"
  | "delete_project"
  | "post_cleanup_verify";

export const GAUNTLET_STAGE_ORDER: readonly GauntletStageName[] = [
  "preflight",
  "create_project",
  "wait_for_health",
  "push_schema",
  "inspect_schema",
  "inspect_schema_deep",
  "api_insert",
  "api_select",
  "backup_create",
  "backup_verify",
  "delete_project",
  "post_cleanup_verify",
] as const;

export interface StageError {
  message: string;
  stack?: string;
  cause?: unknown;
}

export interface StageRecord {
  name: GauntletStageName;
  status: StageStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  summary?: string;
  error?: StageError;
  artifacts?: Record<string, unknown>;
}

/** JWT fields differ by mode — never assume v1 and v2 share the same model. */
export interface GauntletProjectCtx {
  slug: string;
  hash: string;
  mode: GauntletMode;
  apiUrl: string;
  apiSchema: string;
  /** v2_shared: gateway/project JWT secret from create/credentials. */
  projectJwt?: string;
  /** v1_dedicated: PostgREST anon key (pre-minted JWT). */
  anonJwt?: string;
  /** v1_dedicated: PostgREST service_role key (pre-minted JWT). */
  serviceRoleJwt?: string;
  insertedNoteId?: number;
  insertedEventId?: number;
  backupId?: string;
  reportDir: string;
  schemaSqlPath?: string;
  openapiSnapshot?: unknown;
  projectSummaryBefore?: unknown;
  /** Ring 3 deep Postgres catalog inspection. */
  schemaInspection?: SchemaInspectionResult;
}

export interface GauntletRunOptions {
  mode: GauntletMode;
  runs: number;
  keepFailed: boolean;
  reportDir: string;
  prefix: string;
  skipBackup: boolean;
  json: boolean;
}

export interface GauntletCommandManifest {
  command: "flux gauntlet run";
  argv: string[];
  options: GauntletRunOptions;
  startedAt: string;
}

export interface GauntletRunResult {
  runId: string;
  status: "pass" | "fail";
  mode: GauntletMode;
  projectSlug: string;
  projectHash?: string;
  apiUrl?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  stages: StageRecord[];
  cleanedUp: boolean;
  cleanupError?: string;
  keptForInspection: boolean;
  reportPath: string;
  commandManifest: GauntletCommandManifest;
  failureAnalysis?: string;
  /** Machine-readable reason (especially for v2 gauntlet gaps vs platform failures). */
  failureClass?: GauntletFailureClass;
  failureClassDetail?: string;
}

export interface GauntletRunnerState {
  options: GauntletRunOptions;
  /** Slugs created during this process — cleanup may only delete these. */
  createdProjectSlugs: Set<string>;
  stages: StageRecord[];
  project?: GauntletProjectCtx;
  runStartedAt: string;
  commandManifest: GauntletCommandManifest;
  /** Set by runner before create_project stage. */
  pendingCreate?: { requestedName: string; reportDir: string };
}

/** Thrown by a stage to signal intentional skip (not a failure). */
export class GauntletStageSkip extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "GauntletStageSkip";
    this.reason = reason;
  }
}

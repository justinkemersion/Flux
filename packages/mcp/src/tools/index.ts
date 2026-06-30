/**
 * Flux MCP Pass 1 tools: read / context / preflight only.
 *
 * Every tool returns the standard {@link ToolResult} envelope and never emits
 * secrets (tokens, JWT secrets, DB passwords, anon/service-role keys). Tools
 * are built against the small {@link FluxToolClient} interface so they can be
 * unit-tested with a fake client.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  classifyNewestBackup,
  destructiveBackupCheckMessage,
} from "@flux/core/backup-trust";
import type { BackupTrustInput } from "@flux/core/backup-trust";
import type {
  CreateProjectBackupResult,
  DatabaseAccessPlan,
  DbAccessLevel,
  DoctorReport,
  FluxMigrationRecord,
  FluxProjectSummary,
  ListProjectBackupsResult,
  ProjectActivityResponse,
  ProjectFluxMdDetail,
  ProjectLifecycleInfo,
  ProjectMetadata,
  SchemaInspectionResult,
  TemporaryDbCredential,
  VerifyBackupResult,
} from "@flux/cli/api-client";
import type { IntentClass } from "../policy";
import { InvalidInputError, ok, type ToolResult } from "../result";
import { buildMigrationPlan } from "./migration-plan";
import { runBackupEnsureVerified } from "./backup-ensure";
import { sanitizeBackupListForMcp } from "./backup-sanitize";
import {
  DEFAULT_ROW_CAP,
  MAX_ROW_CAP,
  validateReadonlyQuery,
} from "./query-validate";
import {
  liveReadonlyQueryExecutor,
  type ReadonlyQueryExecutor,
} from "./query-executor";

/** Minimal control-plane surface used by Pass 1 tools (satisfied by `ApiClient`). */
export interface FluxToolClient {
  listProjects(): Promise<FluxProjectSummary[]>;
  getProjectMetadata(hash: string): Promise<ProjectMetadata>;
  getProjectLifecycleState(hash: string): Promise<ProjectLifecycleInfo>;
  fetchProjectFluxMdDetail(hash: string): Promise<ProjectFluxMdDetail>;
  schemaInspectProject(input: {
    hash: string;
    includeExactCounts?: boolean;
  }): Promise<SchemaInspectionResult>;
  listAppliedMigrations(hash: string): Promise<FluxMigrationRecord[]>;
  runDoctor(hash: string): Promise<DoctorReport>;
  fetchProjectActivity(hash: string, limit?: number): Promise<ProjectActivityResponse>;
  listProjectBackups(hash: string): Promise<ListProjectBackupsResult>;
  createProjectBackup(hash: string): Promise<CreateProjectBackupResult>;
  verifyProjectBackup(input: {
    hash: string;
    backupId: string;
  }): Promise<VerifyBackupResult>;
  getProjectDbAccessPlan(hash: string): Promise<DatabaseAccessPlan>;
  createTemporaryProjectDbCredential(
    hash: string,
    options?: { access?: DbAccessLevel; ttlSeconds?: number },
  ): Promise<TemporaryDbCredential>;
  recordMcpAuditEvent(
    input: import("@flux/cli/api-client").RecordMcpAuditEventInput,
  ): Promise<import("@flux/cli/api-client").RecordMcpAuditEventResult>;
  createMcpIntent(
    input: import("@flux/cli/api-client").CreateMcpIntentInput,
  ): Promise<import("@flux/cli/api-client").CreateMcpIntentResult>;
  updateMcpIntent(
    intentId: string,
    input: import("@flux/cli/api-client").UpdateMcpIntentInput,
  ): Promise<import("@flux/cli/api-client").UpdateMcpIntentResult>;
}

export interface ProtectiveMutationContext {
  intentId: string;
}

/** Injectable dependencies for tools that touch the database directly. */
export interface ToolDeps {
  queryExecutor?: ReadonlyQueryExecutor;
}

export interface ToolDef {
  name: string;
  description: string;
  intentClass: IntentClass;
  inputSchema: Tool["inputSchema"];
  handler(
    args: Record<string, unknown>,
    ctx?: ProtectiveMutationContext,
  ): Promise<ToolResult>;
}

/**
 * Non-failing advisory surfaced in `flux.project.describe` output. Agents can
 * react to these (e.g. sync a FLUX.md brief) without the tool call failing.
 */
export interface DescribeWarning {
  code: "agent_context_missing" | "plan_limit_exceeded";
  severity: "info" | "warning";
  message: string;
}

const HASH_INPUT_SCHEMA: Tool["inputSchema"] = {
  type: "object",
  properties: {
    hash: {
      type: "string",
      description: "Project hash (7 hex chars) — see flux.project.list.",
    },
  },
  required: ["hash"],
  additionalProperties: false,
};

function requireHash(args: Record<string, unknown>): string {
  const raw = args.hash;
  const hash = typeof raw === "string" ? raw.trim() : "";
  if (!hash) {
    throw new InvalidInputError("Missing required string argument: hash");
  }
  return hash;
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const raw = args[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "boolean") {
    throw new InvalidInputError(`Argument "${key}" must be a boolean`);
  }
  return raw;
}

function optionalPositiveInt(
  args: Record<string, unknown>,
  key: string,
): number | undefined {
  const raw = args[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    throw new InvalidInputError(`Argument "${key}" must be a positive integer`);
  }
  return raw;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const raw = args[key];
  const value = typeof raw === "string" ? raw : "";
  if (!value.trim()) {
    throw new InvalidInputError(`Missing required string argument: ${key}`);
  }
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const DEFAULT_CREDENTIAL_TTL_SECONDS = 900;
const MIN_CREDENTIAL_TTL_SECONDS = 60;
const MAX_CREDENTIAL_TTL_SECONDS = 3600;

const DEFAULT_QUERY_TIMEOUT_MS = 5000;
const MIN_QUERY_TIMEOUT_MS = 100;
const MAX_QUERY_TIMEOUT_MS = 30000;

export function buildTools(
  client: FluxToolClient,
  deps: ToolDeps = {},
): ToolDef[] {
  const queryExecutor = deps.queryExecutor ?? liveReadonlyQueryExecutor;
  return [
    {
      name: "flux.project.list",
      description:
        "List Flux projects owned by the authenticated token (slug, hash, status, API URL, lifecycle). No secrets.",
      intentClass: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async (): Promise<ToolResult> => {
        const projects = await client.listProjects();
        return ok(`${projects.length} project(s).`, { projects });
      },
    },
    {
      name: "flux.project.describe",
      description:
        "Describe a project: metadata (slug, mode, API schema), lifecycle state, and the FLUX.md brief. No secrets.",
      intentClass: "read",
      inputSchema: HASH_INPUT_SCHEMA,
      handler: async (args): Promise<ToolResult> => {
        const hash = requireHash(args);
        const metadata = await client.getProjectMetadata(hash);
        const [lifecycle, brief] = await Promise.all([
          client.getProjectLifecycleState(hash).catch(() => null),
          client.fetchProjectFluxMdDetail(hash).catch(() => null),
        ]);

        const warnings: DescribeWarning[] = [];
        const hasBrief =
          (brief?.content ?? "").trim().length > 0 ||
          (metadata.brief ?? "").trim().length > 0;
        if (!hasBrief) {
          warnings.push({
            code: "agent_context_missing",
            severity: "info",
            message: "No FLUX.md brief is synced for this project.",
          });
        }
        if (lifecycle && lifecycle.activeCount > lifecycle.activeLimit) {
          warnings.push({
            code: "plan_limit_exceeded",
            severity: "warning",
            message: "activeCount exceeds activeLimit.",
          });
        }

        return ok(`Project ${metadata.slug} (${metadata.mode}).`, {
          metadata,
          lifecycle,
          brief,
          warnings,
        });
      },
    },
    {
      name: "flux.schema.inspect",
      description:
        "Read-only schema introspection: tables, columns, primary/foreign keys, RLS state, grants, and warnings.",
      intentClass: "read",
      inputSchema: {
        type: "object",
        properties: {
          hash: {
            type: "string",
            description: "Project hash (7 hex chars).",
          },
          includeExactCounts: {
            type: "boolean",
            description: "Run exact count(*) per table (slower). Defaults to false.",
          },
        },
        required: ["hash"],
        additionalProperties: false,
      },
      handler: async (args): Promise<ToolResult> => {
        const hash = requireHash(args);
        const includeExactCounts = optionalBoolean(args, "includeExactCounts");
        const result = await client.schemaInspectProject(
          includeExactCounts !== undefined
            ? { hash, includeExactCounts }
            : { hash },
        );
        return ok(
          `${result.summary.tableCount} table(s) in schema ${result.project.schema}.`,
          result,
        );
      },
    },
    {
      name: "flux.schema.counts",
      description:
        "Per-table row counts (exact) plus a schema summary. No table contents are returned.",
      intentClass: "read",
      inputSchema: HASH_INPUT_SCHEMA,
      handler: async (args): Promise<ToolResult> => {
        const hash = requireHash(args);
        const result = await client.schemaInspectProject({
          hash,
          includeExactCounts: true,
        });
        const tables = result.tables.map((t) => ({
          schema: t.schema,
          name: t.name,
          estimatedRows: t.estimatedRows ?? null,
        }));
        return ok(`${result.summary.tableCount} table(s) in ${result.project.schema}.`, {
          schema: result.project.schema,
          tableCount: result.summary.tableCount,
          tables,
        });
      },
    },
    {
      name: "flux.migrations.list",
      description:
        "List applied migrations from the tenant migration ledger (version, filename, checksum, applied_at).",
      intentClass: "read",
      inputSchema: HASH_INPUT_SCHEMA,
      handler: async (args): Promise<ToolResult> => {
        const hash = requireHash(args);
        const migrations = await client.listAppliedMigrations(hash);
        return ok(`${migrations.length} applied migration(s).`, { migrations });
      },
    },
    {
      name: "flux.doctor",
      description:
        "Run the project health doctor: DB reachability, API probe, migration ledger, and backup trust checks.",
      intentClass: "read",
      inputSchema: HASH_INPUT_SCHEMA,
      handler: async (args): Promise<ToolResult> => {
        const hash = requireHash(args);
        const report = await client.runDoctor(hash);
        return ok(`Doctor overall status: ${report.overallStatus}.`, report);
      },
    },
    {
      name: "flux.activity",
      description: "Recent project activity timeline events.",
      intentClass: "read",
      inputSchema: {
        type: "object",
        properties: {
          hash: { type: "string", description: "Project hash (7 hex chars)." },
          limit: {
            type: "integer",
            description: "Max events to return (positive integer).",
          },
        },
        required: ["hash"],
        additionalProperties: false,
      },
      handler: async (args): Promise<ToolResult> => {
        const hash = requireHash(args);
        const limit = optionalPositiveInt(args, "limit");
        const activity =
          limit !== undefined
            ? await client.fetchProjectActivity(hash, limit)
            : await client.fetchProjectActivity(hash);
        return ok(`${activity.events.length} activity event(s).`, activity);
      },
    },
    {
      name: "flux.backup.list",
      description:
        "List backups for a project (status, kind, validation/restore-verification state). No secrets.",
      intentClass: "read",
      inputSchema: HASH_INPUT_SCHEMA,
      handler: async (args): Promise<ToolResult> => {
        const hash = requireHash(args);
        const result = await client.listProjectBackups(hash);
        const data = sanitizeBackupListForMcp(result);
        return ok(`${data.backups.length} backup(s).`, data);
      },
    },
    {
      name: "flux.destructive.preflight",
      description:
        "Check whether destructive operations are currently allowed for a project by classifying the latest backup's restore-verified trust. Read-only; performs no mutation.",
      intentClass: "preflight",
      inputSchema: HASH_INPUT_SCHEMA,
      handler: async (args): Promise<ToolResult> => {
        const hash = requireHash(args);
        const { backups } = await client.listProjectBackups(hash);
        const classification = classifyNewestBackup(
          backups as unknown as BackupTrustInput[],
        );
        const data = {
          allowed: classification.allowsDestructiveWithoutOverride,
          tier: classification.tier,
          detail: classification.detail,
        };
        if (classification.allowsDestructiveWithoutOverride) {
          return ok(
            "Destructive actions are ALLOWED: latest backup is restore-verified.",
            data,
          );
        }
        return ok(
          "Destructive actions are BLOCKED: no restore-verified backup.",
          data,
          destructiveBackupCheckMessage(classification),
        );
      },
    },
    {
      name: "flux.backup.ensureVerified",
      description:
        "Ensure a restore-verified backup exists for a project (protective mutation). Reuses an existing restore-verified backup when fresh enough; otherwise creates and verifies a new backup. Never accepts skipBackupCheck.",
      intentClass: "protective_mutation",
      inputSchema: {
        type: "object",
        properties: {
          hash: { type: "string", description: "Project hash (7 hex chars)." },
          slug: { type: "string", description: "Optional project slug (audit label only)." },
          reason: { type: "string", description: "Optional operator/agent reason (audit only)." },
          verifyLatestIfFresh: {
            type: "boolean",
            description:
              "When true (default), reuse the latest restore-verified backup if fresh enough.",
            default: true,
          },
          maxAgeHours: {
            type: "number",
            description: "Optional max age in hours for backup reuse.",
          },
          wait: {
            type: "boolean",
            description:
              "When true (default), poll until the backup is complete before verify.",
            default: true,
          },
        },
        required: ["hash"],
        additionalProperties: false,
      },
      handler: async (args, ctx): Promise<ToolResult> => {
        if (!ctx?.intentId) {
          throw new Error("flux.backup.ensureVerified requires a persisted intent context.");
        }
        return runBackupEnsureVerified(client, args, { intentId: ctx.intentId });
      },
    },
    {
      name: "flux.migration.plan",
      description:
        "Plan local SQL migrations against the applied ledger (no apply). Returns a planId, stable planHash, files to apply/skip, conflicts, warnings, and whether the plan looks destructive-shaped.",
      intentClass: "plan",
      inputSchema: {
        type: "object",
        properties: {
          hash: { type: "string", description: "Project hash (7 hex chars)." },
          slug: { type: "string", description: "Optional project slug (label only)." },
          workspaceRoot: {
            type: "string",
            description:
              "Absolute repo root. If omitted, cwd is used only when it contains flux.json.",
          },
          migrationsPath: {
            type: "string",
            description:
              "Migrations directory, absolute or relative to workspaceRoot (e.g. \"migrations\").",
          },
          mode: {
            type: "string",
            enum: ["v1_dedicated", "v2_shared"],
            description: "Optional mode hint (informational).",
          },
        },
        required: ["hash", "migrationsPath"],
        additionalProperties: false,
      },
      handler: async (args): Promise<ToolResult> => {
        const hash = requireHash(args);
        const slug = typeof args.slug === "string" ? args.slug : undefined;
        const workspaceRoot =
          typeof args.workspaceRoot === "string" ? args.workspaceRoot : undefined;
        const migrationsPath =
          typeof args.migrationsPath === "string" ? args.migrationsPath : undefined;
        const data = await buildMigrationPlan(
          {
            hash,
            ...(slug ? { slug } : {}),
            ...(workspaceRoot ? { workspaceRoot } : {}),
            ...(migrationsPath ? { migrationsPath } : {}),
          },
          (h) => client.listAppliedMigrations(h),
        );
        const summary = `Plan ${data.planHash.slice(0, 12)}: ${String(data.counts.apply)} to apply, ${String(data.counts.skip)} to skip, ${String(data.counts.conflicts)} conflict(s)${data.destructiveShaped ? " (destructive-shaped)" : ""}.`;
        if (data.conflicts.length > 0) {
          return ok(
            summary,
            data,
            "Resolve checksum conflicts: create a new migration instead of editing an applied one.",
          );
        }
        return ok(summary, data);
      },
    },
    {
      name: "flux.credentials.temporary",
      description:
        "Issue a short-lived, READONLY, project-scoped database credential (v2_shared only). Never returns pooled admin or service-role secrets.",
      intentClass: "credential",
      inputSchema: {
        type: "object",
        properties: {
          hash: { type: "string", description: "Project hash (7 hex chars)." },
          access: {
            type: "string",
            enum: ["ro"],
            description: "Must be \"ro\" (read-only). Read/write is not available.",
          },
          ttlSeconds: {
            type: "integer",
            description: `Lifetime in seconds (default ${String(DEFAULT_CREDENTIAL_TTL_SECONDS)}, max ${String(MAX_CREDENTIAL_TTL_SECONDS)}).`,
          },
        },
        required: ["hash"],
        additionalProperties: false,
      },
      handler: async (args): Promise<ToolResult> => {
        const hash = requireHash(args);
        if (args.access !== undefined && args.access !== "ro") {
          throw new InvalidInputError('access must be "ro" (read-only).');
        }
        const ttlRaw = optionalPositiveInt(args, "ttlSeconds");
        const ttlSeconds = clamp(
          ttlRaw ?? DEFAULT_CREDENTIAL_TTL_SECONDS,
          MIN_CREDENTIAL_TTL_SECONDS,
          MAX_CREDENTIAL_TTL_SECONDS,
        );

        const metadata = await client.getProjectMetadata(hash);
        if (metadata.mode !== "v2_shared") {
          throw new InvalidInputError(
            "flux.credentials.temporary is only available for v2_shared projects.",
          );
        }

        const credential = await client.createTemporaryProjectDbCredential(hash, {
          access: "readonly",
          ttlSeconds,
        });
        if (credential.access !== "readonly") {
          throw new Error("Refusing to return a non-readonly credential.");
        }
        return ok(
          `Temporary readonly credential for ${metadata.slug} (expires ${credential.expiresAt}).`,
          { credential },
        );
      },
    },
    {
      name: "flux.query.readonly",
      description:
        "Run a single bounded, read-only SQL query (SELECT/WITH only) using a short-lived readonly credential (v2_shared only). Enforces statement timeout and a hard row cap; rejects any non-read SQL.",
      intentClass: "read",
      inputSchema: {
        type: "object",
        properties: {
          hash: { type: "string", description: "Project hash (7 hex chars)." },
          sql: {
            type: "string",
            description: "A single SELECT or WITH statement. No mutations.",
          },
          rowCap: {
            type: "integer",
            description: `Max rows returned (default ${String(DEFAULT_ROW_CAP)}, max ${String(MAX_ROW_CAP)}).`,
          },
          statementTimeoutMs: {
            type: "integer",
            description: `Statement timeout in ms (default ${String(DEFAULT_QUERY_TIMEOUT_MS)}, max ${String(MAX_QUERY_TIMEOUT_MS)}).`,
          },
        },
        required: ["hash", "sql"],
        additionalProperties: false,
      },
      handler: async (args): Promise<ToolResult> => {
        const hash = requireHash(args);
        const sql = requireString(args, "sql");
        const rowCapRaw = optionalPositiveInt(args, "rowCap");
        const timeoutRaw = optionalPositiveInt(args, "statementTimeoutMs");
        const statementTimeoutMs = clamp(
          timeoutRaw ?? DEFAULT_QUERY_TIMEOUT_MS,
          MIN_QUERY_TIMEOUT_MS,
          MAX_QUERY_TIMEOUT_MS,
        );

        // Validate BEFORE any credential issuance or DB access: this is where
        // write/mutation attempts are denied.
        const { wrapped, cap } = validateReadonlyQuery(sql, {
          ...(rowCapRaw !== undefined ? { rowCap: rowCapRaw } : {}),
        });

        const metadata = await client.getProjectMetadata(hash);
        if (metadata.mode !== "v2_shared") {
          throw new InvalidInputError(
            "flux.query.readonly is only available for v2_shared projects.",
          );
        }

        const [plan, credential] = await Promise.all([
          client.getProjectDbAccessPlan(hash),
          client.createTemporaryProjectDbCredential(hash, {
            access: "readonly",
            ttlSeconds: DEFAULT_CREDENTIAL_TTL_SECONDS,
          }),
        ]);
        if (credential.access !== "readonly") {
          throw new Error("Refusing to use a non-readonly credential.");
        }

        const exec = await queryExecutor.run({
          plan,
          credential,
          wrappedSql: wrapped,
          statementTimeoutMs,
        });
        const truncated = exec.rows.length > cap;
        const rows = truncated ? exec.rows.slice(0, cap) : exec.rows;
        return ok(
          `${String(rows.length)} row(s)${truncated ? " (truncated at row cap)" : ""}.`,
          {
            rows,
            fields: exec.fields,
            rowCount: rows.length,
            truncated,
            rowCap: cap,
            statementTimeoutMs,
          },
        );
      },
    },
  ];
}

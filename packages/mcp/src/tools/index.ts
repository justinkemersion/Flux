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
  DoctorReport,
  FluxMigrationRecord,
  FluxProjectSummary,
  ListProjectBackupsResult,
  ProjectActivityResponse,
  ProjectFluxMdDetail,
  ProjectLifecycleInfo,
  ProjectMetadata,
  SchemaInspectionResult,
} from "@flux/cli/api-client";
import type { IntentClass } from "../policy";
import { InvalidInputError, ok, type ToolResult } from "../result";

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
}

export interface ToolDef {
  name: string;
  description: string;
  intentClass: IntentClass;
  inputSchema: Tool["inputSchema"];
  handler(args: Record<string, unknown>): Promise<ToolResult>;
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

export function buildTools(client: FluxToolClient): ToolDef[] {
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
        return ok(`Project ${metadata.slug} (${metadata.mode}).`, {
          metadata,
          lifecycle,
          brief,
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
        return ok(`${result.backups.length} backup(s).`, result);
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
  ];
}

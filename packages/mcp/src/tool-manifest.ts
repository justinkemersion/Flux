/**
 * Canonical Flux MCP v0.1 tool contract manifest.
 * Single source of truth for tool metadata, capabilities, risk, and routes.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpCapability } from "@flux/cli/api-client";
import type { IntentClass } from "./policy.js";
import { FLUX_MCP_CONTRACT_VERSION } from "@flux/core/mcp-contract";

export { FLUX_MCP_CONTRACT_VERSION };

export const FLUX_MCP_RISK_LEVELS = [
  "read_context",
  "read_sensitive_metadata",
  "plan_only",
  "safe_mutation",
  "guarded_mutation",
  "blocked_destructive",
] as const;

export type FluxMcpRiskLevel = (typeof FLUX_MCP_RISK_LEVELS)[number];

export const FLUX_MCP_OPERATION_CLASSES = ["read", "write", "destructive"] as const;
export type FluxMcpOperationClass = (typeof FLUX_MCP_OPERATION_CLASSES)[number];

export const FLUX_MCP_SECRET_POLICIES = [
  "standard_redact",
  "sanitize_backups",
  "redact_sql_and_credentials",
  "never_return_secrets",
] as const;

export type FluxMcpSecretPolicy = (typeof FLUX_MCP_SECRET_POLICIES)[number];

/** Tool names that must never appear in tools/list (destructive lifecycle). */
export const FLUX_MCP_BLOCKED_TOOL_NAMES = [
  "flux.nuke",
  "flux.project.delete",
  "flux.factoryReset",
  "flux.dbReset",
  "flux.restore",
  "flux.migrate",
  "flux.push.raw",
  "flux.lifecycle",
  "flux.project.create",
  "flux.project.init",
] as const;

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

export interface FluxMcpToolManifestEntry {
  name: string;
  description: string;
  inputSchema: Tool["inputSchema"];
  requiredCapability: McpCapability;
  riskLevel: FluxMcpRiskLevel;
  operationClass: FluxMcpOperationClass;
  route: string;
  auditEventKind: IntentClass;
  secretPolicy: FluxMcpSecretPolicy;
}

export const FLUX_MCP_TOOL_MANIFEST: readonly FluxMcpToolManifestEntry[] = [
  {
    name: "flux.project.list",
    description:
      "List Flux projects owned by the authenticated token (slug, hash, status, API URL, lifecycle). No secrets.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    requiredCapability: "project:read",
    riskLevel: "read_context",
    operationClass: "read",
    route: "GET /api/cli/v1/list",
    auditEventKind: "read",
    secretPolicy: "standard_redact",
  },
  {
    name: "flux.project.describe",
    description:
      "Describe a project: metadata (slug, mode, API schema), lifecycle state, and the FLUX.md brief. No secrets.",
    inputSchema: HASH_INPUT_SCHEMA,
    requiredCapability: "project:read",
    riskLevel: "read_context",
    operationClass: "read",
    route: "GET /api/cli/v1/projects/:hash/metadata (+ lifecycle-state, flux-md)",
    auditEventKind: "read",
    secretPolicy: "standard_redact",
  },
  {
    name: "flux.schema.inspect",
    description:
      "Read-only schema introspection: tables, columns, primary/foreign keys, RLS state, grants, and warnings.",
    inputSchema: {
      type: "object",
      properties: {
        hash: { type: "string", description: "Project hash (7 hex chars)." },
        includeExactCounts: {
          type: "boolean",
          description: "Run exact count(*) per table (slower). Defaults to false.",
        },
      },
      required: ["hash"],
      additionalProperties: false,
    },
    requiredCapability: "schema:read",
    riskLevel: "read_sensitive_metadata",
    operationClass: "read",
    route: "POST /api/cli/v1/projects/:hash/schema-inspection",
    auditEventKind: "read",
    secretPolicy: "standard_redact",
  },
  {
    name: "flux.schema.counts",
    description:
      "Per-table row counts (exact) plus a schema summary. No table contents are returned.",
    inputSchema: HASH_INPUT_SCHEMA,
    requiredCapability: "schema:read",
    riskLevel: "read_sensitive_metadata",
    operationClass: "read",
    route: "POST /api/cli/v1/projects/:hash/schema-inspection",
    auditEventKind: "read",
    secretPolicy: "standard_redact",
  },
  {
    name: "flux.migrations.list",
    description:
      "List applied migrations from the tenant migration ledger (version, filename, checksum, applied_at).",
    inputSchema: HASH_INPUT_SCHEMA,
    requiredCapability: "schema:read",
    riskLevel: "read_sensitive_metadata",
    operationClass: "read",
    route: "GET /api/cli/v1/projects/:hash/migrations",
    auditEventKind: "read",
    secretPolicy: "standard_redact",
  },
  {
    name: "flux.doctor",
    description:
      "Run the project health doctor: DB reachability, API probe, migration ledger, and backup trust checks.",
    inputSchema: HASH_INPUT_SCHEMA,
    requiredCapability: "project:read",
    riskLevel: "read_context",
    operationClass: "read",
    route: "POST /api/cli/v1/projects/:hash/doctor",
    auditEventKind: "read",
    secretPolicy: "standard_redact",
  },
  {
    name: "flux.activity",
    description: "Recent project activity timeline events.",
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
    requiredCapability: "activity:read",
    riskLevel: "read_context",
    operationClass: "read",
    route: "GET /api/cli/v1/projects/:hash/activity",
    auditEventKind: "read",
    secretPolicy: "standard_redact",
  },
  {
    name: "flux.backup.list",
    description:
      "List backups for a project (status, kind, validation/restore-verification state). No secrets.",
    inputSchema: HASH_INPUT_SCHEMA,
    requiredCapability: "backup:read",
    riskLevel: "read_sensitive_metadata",
    operationClass: "read",
    route: "GET /api/cli/v1/projects/:hash/backups",
    auditEventKind: "read",
    secretPolicy: "sanitize_backups",
  },
  {
    name: "flux.destructive.preflight",
    description:
      "Check whether destructive operations are currently allowed for a project by classifying the latest backup's restore-verified trust. Read-only; performs no mutation.",
    inputSchema: HASH_INPUT_SCHEMA,
    requiredCapability: "backup:read",
    riskLevel: "plan_only",
    operationClass: "read",
    route: "GET /api/cli/v1/projects/:hash/backups (client-side backup-trust)",
    auditEventKind: "preflight",
    secretPolicy: "sanitize_backups",
  },
  {
    name: "flux.backup.ensureVerified",
    description:
      "Ensure a restore-verified backup exists for a project (protective mutation). Reuses an existing restore-verified backup when fresh enough; otherwise creates and verifies a new backup. Never accepts skipBackupCheck.",
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
    requiredCapability: "backup:ensure_verified",
    riskLevel: "guarded_mutation",
    operationClass: "write",
    route: "POST /api/cli/v1/projects/:hash/backups (+ verify)",
    auditEventKind: "protective_mutation",
    secretPolicy: "sanitize_backups",
  },
  {
    name: "flux.migration.plan",
    description:
      "Plan local SQL migrations against the applied ledger (no apply). Returns a planId, stable planHash, files to apply/skip, conflicts, warnings, and whether the plan looks destructive-shaped.",
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
            'Migrations directory, absolute or relative to workspaceRoot (e.g. "migrations").',
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
    requiredCapability: "migration:plan",
    riskLevel: "plan_only",
    operationClass: "read",
    route: "GET /api/cli/v1/projects/:hash/migrations (local plan)",
    auditEventKind: "plan",
    secretPolicy: "standard_redact",
  },
  {
    name: "flux.migration.apply",
    description:
      "Apply a prior flux.migration.plan apply set only. Requires restore-verified backup (default), persisted audit/intent, matching planId/planHash, and allowDestructive for destructive-shaped plans. No arbitrary SQL.",
    inputSchema: {
      type: "object",
      properties: {
        hash: { type: "string", description: "Project hash (7 hex chars)." },
        slug: { type: "string", description: "Optional project slug (defaults from metadata)." },
        planId: { type: "string", description: "planId from flux.migration.plan." },
        planHash: { type: "string", description: "planHash from flux.migration.plan." },
        workspaceRoot: {
          type: "string",
          description:
            "Absolute repo root. If omitted, cwd is used only when it contains flux.json.",
        },
        migrationsPath: {
          type: "string",
          description:
            "Migrations directory, absolute or relative to workspaceRoot (must match planning).",
        },
        reason: {
          type: "string",
          description: "Optional operator, human-readable reason (audit only).",
        },
        requireVerifiedBackup: {
          type: "boolean",
          description:
            "When true (default), refuse unless a restore-verified backup exists.",
          default: true,
        },
        allowDestructive: {
          type: "boolean",
          description:
            "When true, allow destructive-shaped plans (still requires restore-verified backup).",
          default: false,
        },
      },
      required: ["hash", "planId", "planHash", "migrationsPath"],
      additionalProperties: false,
    },
    requiredCapability: "migration:apply",
    riskLevel: "guarded_mutation",
    operationClass: "write",
    route: "POST /api/cli/v1/push",
    auditEventKind: "write",
    secretPolicy: "never_return_secrets",
  },
  {
    name: "flux.credentials.temporary",
    description:
      "Issue a short-lived, READONLY, project-scoped database credential (v2_shared only). Never returns pooled admin or service-role secrets.",
    inputSchema: {
      type: "object",
      properties: {
        hash: { type: "string", description: "Project hash (7 hex chars)." },
        access: {
          type: "string",
          enum: ["ro"],
          description: 'Must be "ro" (read-only). Read/write is not available.',
        },
        ttlSeconds: {
          type: "integer",
          description: "Lifetime in seconds (default 900, max 3600).",
        },
      },
      required: ["hash"],
      additionalProperties: false,
    },
    requiredCapability: "query:readonly",
    riskLevel: "guarded_mutation",
    operationClass: "write",
    route: "POST /api/cli/v1/projects/:hash/db-access/temporary-credential",
    auditEventKind: "credential",
    secretPolicy: "redact_sql_and_credentials",
  },
  {
    name: "flux.query.readonly",
    description:
      "Run a single bounded, read-only SQL query (SELECT/WITH only) using a short-lived readonly credential (v2_shared only). Enforces statement timeout and a hard row cap; rejects any non-read SQL.",
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
          description: "Max rows returned (default 100, max 500).",
        },
        statementTimeoutMs: {
          type: "integer",
          description: "Statement timeout in ms (default 5000, max 30000).",
        },
      },
      required: ["hash", "sql"],
      additionalProperties: false,
    },
    requiredCapability: "query:readonly",
    riskLevel: "read_sensitive_metadata",
    operationClass: "read",
    route: "POST /api/cli/v1/projects/:hash/query",
    auditEventKind: "read",
    secretPolicy: "redact_sql_and_credentials",
  },
] as const;

export function manifestEntryByName(name: string): FluxMcpToolManifestEntry | undefined {
  return FLUX_MCP_TOOL_MANIFEST.find((entry) => entry.name === name);
}

export function manifestToolNames(): string[] {
  return FLUX_MCP_TOOL_MANIFEST.map((entry) => entry.name);
}

export function manifestRequiredCapabilities(): Record<string, McpCapability> {
  return Object.fromEntries(
    FLUX_MCP_TOOL_MANIFEST.map((entry) => [entry.name, entry.requiredCapability]),
  ) as Record<string, McpCapability>;
}

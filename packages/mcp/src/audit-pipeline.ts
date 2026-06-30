/**
 * MCP audit + intent persistence pipeline (Phase 3A + 3B).
 *
 * Preserves stderr JSON audit lines and additionally persists audit events (and
 * intents for selected tools) via the CLI control-plane API.
 */

import type {
  CreateMcpIntentInput,
  RecordMcpAuditEventInput,
  UpdateMcpIntentInput,
} from "@flux/cli/api-client";
import { emitAudit, redactValue, type AuditEvent } from "./audit";
import {
  auditPersistenceRequired,
  isIntentTrackedTool,
  type IntentClass,
} from "./policy";
import type { ToolResult } from "./result";
import { sanitizeBackupMetadata } from "./tools/backup-sanitize";
import {
  migrationApplyAuditMetadata,
  type MigrationApplyFailureData,
  type MigrationApplyStaleFailureData,
  type MigrationApplySuccessData,
} from "./tools/migration-apply";

export interface McpPersistenceClient {
  recordMcpAuditEvent(input: RecordMcpAuditEventInput): Promise<{ ok: true; auditId: string }>;
  createMcpIntent(input: CreateMcpIntentInput): Promise<{ intentId: string; status: string }>;
  updateMcpIntent?(
    intentId: string,
    input: UpdateMcpIntentInput,
  ): Promise<{ intentId: string; status: string }>;
}

const INTENT_TRACKED_TOOLS = new Set([
  "flux.migration.plan",
  "flux.credentials.temporary",
  "flux.query.readonly",
  "flux.destructive.preflight",
  "flux.backup.ensureVerified",
  "flux.migration.apply",
]);

const POST_HOC_INTENT_TOOLS = new Set([
  "flux.migration.plan",
  "flux.credentials.temporary",
  "flux.query.readonly",
  "flux.destructive.preflight",
]);

export function projectHashFromArgs(args: Record<string, unknown>): string | undefined {
  const hash = args.hash;
  if (typeof hash !== "string") return undefined;
  const h = hash.trim().toLowerCase();
  return /^[a-f0-9]{7}$/u.test(h) ? h : undefined;
}

export function requestSummaryFromArgs(args: Record<string, unknown>): Record<string, unknown> {
  const summary = redactValue({ ...args }) as Record<string, unknown>;
  if (typeof summary.sql === "string") {
    summary.sql = "[redacted]";
  }
  return summary;
}

function buildAuditPayload(
  event: AuditEvent,
  args: Record<string, unknown>,
): RecordMcpAuditEventInput {
  const projectHash = projectHashFromArgs(args);
  const payload: RecordMcpAuditEventInput = {
    tool: event.tool,
    intentClass: event.intentClass,
    decision: event.decision,
    requestSummary: requestSummaryFromArgs(args),
    resultStatus: event.status,
    durationMs: event.durationMs,
    ...(projectHash ? { projectHash } : {}),
    ...(event.errorCode !== undefined ? { errorCode: event.errorCode } : {}),
    ...(event.gate !== undefined ? { gate: event.gate } : {}),
  };
  return payload;
}

function intentStatusFrom(event: AuditEvent): "completed" | "failed" | "denied" {
  if (event.decision === "deny") return "denied";
  return event.status === "ok" ? "completed" : "failed";
}

function riskLevelForTool(tool: string, intentClass: IntentClass): CreateMcpIntentInput["riskLevel"] {
  if (tool === "flux.credentials.temporary" || intentClass === "credential") {
    return "sensitive";
  }
  if (tool === "flux.destructive.preflight") {
    return "medium";
  }
  if (tool === "flux.migration.plan") {
    return "medium";
  }
  if (tool === "flux.migration.apply") {
    return "medium";
  }
  return "low";
}

function buildIntentPayload(
  event: AuditEvent,
  args: Record<string, unknown>,
  result?: ToolResult,
): CreateMcpIntentInput | null {
  if (!INTENT_TRACKED_TOOLS.has(event.tool)) {
    return null;
  }

  const projectHash = projectHashFromArgs(args);
  const status = intentStatusFrom(event);
  const base: CreateMcpIntentInput = {
    tool: event.tool,
    intentClass: event.intentClass as CreateMcpIntentInput["intentClass"],
    status,
    riskLevel: riskLevelForTool(event.tool, event.intentClass),
    policyDecision: event.decision,
    requestSummary: requestSummaryFromArgs(args),
    resultStatus: event.status,
    ...(projectHash ? { projectHash } : {}),
    ...(event.errorCode !== undefined ? { errorCode: event.errorCode } : {}),
  };

  if (event.tool === "flux.migration.plan" && result?.data && typeof result.data === "object") {
    const data = result.data as Record<string, unknown>;
    if (typeof data.planId === "string") base.planId = data.planId;
    if (typeof data.planHash === "string") base.planHash = data.planHash;
    if (typeof data.destructiveShaped === "boolean") {
      base.metadata = { destructiveShaped: data.destructiveShaped };
    }
  }

  if (event.tool === "flux.credentials.temporary") {
    base.metadata = {
      access: "readonly",
      ...(typeof args.ttlSeconds === "number" ? { ttlSeconds: args.ttlSeconds } : {}),
    };
  }

  if (event.tool === "flux.query.readonly") {
    base.metadata = {
      ...(typeof args.rowCap === "number" ? { rowCap: args.rowCap } : {}),
      ...(typeof args.statementTimeoutMs === "number"
        ? { statementTimeoutMs: args.statementTimeoutMs }
        : {}),
    };
  }

  if (event.tool === "flux.destructive.preflight" && result?.data && typeof result.data === "object") {
    const data = result.data as Record<string, unknown>;
    base.metadata = {
      allowed: data.allowed,
      tier: data.tier,
      detail: data.detail,
    };
  }

  if (event.tool === "flux.backup.ensureVerified" && result?.data && typeof result.data === "object") {
    const data = result.data as Record<string, unknown>;
    base.metadata = sanitizeBackupMetadata({
      backupId: data.backupId,
      created: data.created,
      verified: data.verified,
      trustTier: data.trustTier,
      detail: data.detail,
      ...(data.platformBackupCompliant !== undefined
        ? { platformBackupCompliant: data.platformBackupCompliant }
        : {}),
    });
  }

  return base;
}

export interface FinalizeAuditOptions {
  event: AuditEvent;
  args: Record<string, unknown>;
  client?: McpPersistenceClient;
  result?: ToolResult;
  warn?: (message: string) => void;
}

export async function finalizeToolAudit(
  options: FinalizeAuditOptions,
): Promise<{ auditPersisted: boolean }> {
  const { event, args, client, result, warn = (m) => process.stderr.write(`${m}\n`) } =
    options;

  emitAudit(event);

  if (!client) {
    return { auditPersisted: false };
  }

  const auditPayload = buildAuditPayload(event, args);
  if (
    event.tool === "flux.migration.plan" &&
    result?.data &&
    typeof result.data === "object"
  ) {
    const data = result.data as Record<string, unknown>;
    if (typeof data.planId === "string") auditPayload.planId = data.planId;
    if (typeof data.planHash === "string") auditPayload.planHash = data.planHash;
  }
  if (
    event.tool === "flux.destructive.preflight" &&
    result?.data &&
    typeof result.data === "object"
  ) {
    const data = result.data as Record<string, unknown>;
    auditPayload.gate =
      typeof data.allowed === "boolean" && data.allowed
        ? "backup_trust_pass"
        : "backup_trust_blocked";
  }
  if (event.tool === "flux.backup.ensureVerified" && event.gate) {
    auditPayload.gate = event.gate;
    if (event.intentId) {
      auditPayload.metadata = { intentId: event.intentId };
    }
  }
  if (event.tool === "flux.migration.apply" && event.gate) {
    auditPayload.gate = event.gate;
    if (event.intentId) {
      auditPayload.metadata = { intentId: event.intentId };
    }
    if (
      result?.data &&
      typeof result.data === "object" &&
      typeof (result.data as { planId?: unknown }).planId === "string"
    ) {
      auditPayload.planId = (result.data as { planId: string }).planId;
    }
    if (
      result?.data &&
      typeof result.data === "object" &&
      typeof (result.data as { planHash?: unknown }).planHash === "string"
    ) {
      auditPayload.planHash = (result.data as { planHash: string }).planHash;
    }
    if (result?.data && typeof result.data === "object") {
      const applyMeta = migrationApplyAuditMetadata(
        result.data as
          | MigrationApplySuccessData
          | MigrationApplyFailureData
          | MigrationApplyStaleFailureData,
      );
      if (applyMeta) {
        auditPayload.metadata = {
          ...(auditPayload.metadata ?? {}),
          ...applyMeta,
        };
      }
    }
  }

  const mustPersist = auditPersistenceRequired(event.intentClass);

  try {
    await client.recordMcpAuditEvent(auditPayload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (mustPersist) {
      throw new Error(`Persistent MCP audit required but unavailable: ${msg}`);
    }
    warn(`[flux-mcp] audit persistence failed (non-fatal): ${msg}`);
    return { auditPersisted: false };
  }

  const skipIntent =
    event.skipIntentCreate === true || !POST_HOC_INTENT_TOOLS.has(event.tool);

  const intentPayload = skipIntent ? null : buildIntentPayload(event, args, result);
  if (intentPayload && isIntentTrackedTool(event.tool)) {
    try {
      await client.createMcpIntent(intentPayload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (mustPersist) {
        throw new Error(`Persistent MCP intent required but unavailable: ${msg}`);
      }
      warn(`[flux-mcp] intent persistence failed (non-fatal): ${msg}`);
    }
  }

  return { auditPersisted: true };
}

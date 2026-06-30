/**
 * MCP audit event validation + persistence for POST /api/cli/v1/audit.
 */

import { mcpAuditEvents } from "@/src/db/schema";
import type { SystemDb } from "@/src/lib/db";
import { containsObviousSecret } from "./mcp-secret-scan";

export const MCP_INTENT_CLASSES = [
  "read",
  "plan",
  "preflight",
  "credential",
  "write",
  "destructive",
] as const;

export type McpIntentClass = (typeof MCP_INTENT_CLASSES)[number];

export const MCP_AUDIT_DECISIONS = ["allow", "deny"] as const;
export type McpAuditDecision = (typeof MCP_AUDIT_DECISIONS)[number];

export const MCP_RESULT_STATUSES = ["ok", "error"] as const;
export type McpResultStatus = (typeof MCP_RESULT_STATUSES)[number];

export interface McpAuditEventInput {
  tool: string;
  intentClass: McpIntentClass;
  decision: McpAuditDecision;
  gate?: string | null;
  planId?: string | null;
  planHash?: string | null;
  projectHash?: string | null;
  projectId?: string | null;
  requestSummary: Record<string, unknown>;
  resultStatus: McpResultStatus;
  errorCode?: string | null;
  durationMs: number;
  metadata?: Record<string, unknown> | null;
  /** Ignored — server derives identity from CLI key auth. */
  userId?: string;
}

export type McpAuditInsertResult =
  | { ok: true; auditId: string }
  | { ok: false; status: number; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown, field: string): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return `${field} must be a non-empty string.`;
  }
  return null;
}

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

export function validateMcpAuditEventInput(
  body: unknown,
): { ok: true; input: McpAuditEventInput } | { ok: false; error: string } {
  if (!isRecord(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const toolErr = nonEmptyString(body.tool, "tool");
  if (toolErr) return { ok: false, error: toolErr };

  const intentClass = body.intentClass;
  if (
    typeof intentClass !== "string" ||
    !(MCP_INTENT_CLASSES as readonly string[]).includes(intentClass)
  ) {
    return { ok: false, error: "intentClass is invalid." };
  }

  const decision = body.decision;
  if (
    typeof decision !== "string" ||
    !(MCP_AUDIT_DECISIONS as readonly string[]).includes(decision)
  ) {
    return { ok: false, error: "decision must be allow or deny." };
  }

  const resultStatus = body.resultStatus;
  if (
    typeof resultStatus !== "string" ||
    !(MCP_RESULT_STATUSES as readonly string[]).includes(resultStatus)
  ) {
    return { ok: false, error: "resultStatus must be ok or error." };
  }

  if (typeof body.durationMs !== "number" || !Number.isFinite(body.durationMs)) {
    return { ok: false, error: "durationMs must be a finite number." };
  }
  const durationMs = Math.max(0, Math.trunc(body.durationMs));

  if (!isRecord(body.requestSummary)) {
    return { ok: false, error: "requestSummary must be a JSON object." };
  }

  const metadataRaw = body.metadata;
  let metadata: Record<string, unknown> | null = null;
  if (metadataRaw !== undefined && metadataRaw !== null) {
    if (!isRecord(metadataRaw)) {
      return { ok: false, error: "metadata must be a JSON object when provided." };
    }
    metadata = metadataRaw;
  }

  const input: McpAuditEventInput = {
    tool: (body.tool as string).trim(),
    intentClass: intentClass as McpIntentClass,
    decision: decision as McpAuditDecision,
    requestSummary: body.requestSummary,
    resultStatus: resultStatus as McpResultStatus,
    durationMs,
    ...(optionalString(body.gate) != null ? { gate: optionalString(body.gate) } : {}),
    ...(optionalString(body.planId) != null ? { planId: optionalString(body.planId) } : {}),
    ...(optionalString(body.planHash) != null
      ? { planHash: optionalString(body.planHash) }
      : {}),
    ...(optionalString(body.projectHash) != null
      ? { projectHash: optionalString(body.projectHash) }
      : {}),
    ...(optionalString(body.projectId) != null
      ? { projectId: optionalString(body.projectId) }
      : {}),
    ...(optionalString(body.errorCode) != null
      ? { errorCode: optionalString(body.errorCode) }
      : {}),
    ...(metadata !== null ? { metadata } : {}),
  };

  if (containsObviousSecret(input.requestSummary)) {
    return { ok: false, error: "requestSummary contains obvious secret material." };
  }
  if (metadata !== null && containsObviousSecret(metadata)) {
    return { ok: false, error: "metadata contains obvious secret material." };
  }

  return { ok: true, input };
}

export async function insertMcpAuditEvent(
  db: SystemDb,
  auth: { userId: string; keyId: string },
  input: McpAuditEventInput,
  projectId: string | null,
): Promise<McpAuditInsertResult> {
  const [row] = await db
    .insert(mcpAuditEvents)
    .values({
      userId: auth.userId,
      keyId: auth.keyId,
      projectId: projectId ?? input.projectId ?? null,
      projectHash: input.projectHash ?? null,
      tool: input.tool,
      intentClass: input.intentClass,
      decision: input.decision,
      gate: input.gate ?? null,
      planId: input.planId ?? null,
      planHash: input.planHash ?? null,
      requestSummary: input.requestSummary,
      resultStatus: input.resultStatus,
      errorCode: input.errorCode ?? null,
      durationMs: input.durationMs,
      metadata: input.metadata ?? null,
    })
    .returning({ id: mcpAuditEvents.id });

  if (!row) {
    return { ok: false, status: 500, error: "Failed to record audit event." };
  }
  return { ok: true, auditId: row.id };
}

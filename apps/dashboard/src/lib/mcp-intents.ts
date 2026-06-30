/**
 * MCP intent validation + persistence for POST/GET /api/cli/v1/intents.
 */

import { and, eq } from "drizzle-orm";
import { mcpIntents, projects } from "@/src/db/schema";
import type { SystemDb } from "@/src/lib/db";
import {
  MCP_INTENT_CLASSES,
  type McpIntentClass,
  type McpResultStatus,
} from "./mcp-audit";
import { containsObviousSecret } from "./mcp-secret-scan";

export const MCP_INTENT_STATUSES = [
  "pending",
  "completed",
  "failed",
  "denied",
] as const;
export type McpIntentStatus = (typeof MCP_INTENT_STATUSES)[number];

export const MCP_RISK_LEVELS = ["low", "medium", "sensitive", "destructive"] as const;
export type McpRiskLevel = (typeof MCP_RISK_LEVELS)[number];

export interface McpIntentInput {
  tool: string;
  intentClass: McpIntentClass;
  status: McpIntentStatus;
  riskLevel: McpRiskLevel;
  planId?: string | null;
  planHash?: string | null;
  projectHash?: string | null;
  projectId?: string | null;
  requestSummary: Record<string, unknown>;
  policyDecision: string;
  requiresApproval?: boolean;
  approvalStatus?: string | null;
  resultStatus?: McpResultStatus | null;
  errorCode?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Ignored — server derives identity from CLI key auth. */
  userId?: string;
}

export type McpIntentInsertResult =
  | { ok: true; intentId: string; status: McpIntentStatus }
  | { ok: false; status: number; error: string };

export type McpIntentGetResult =
  | {
      ok: true;
      intent: {
        intentId: string;
        status: McpIntentStatus;
        tool: string;
        intentClass: McpIntentClass;
        riskLevel: McpRiskLevel;
        projectHash: string | null;
        planId: string | null;
        planHash: string | null;
        policyDecision: string;
        requiresApproval: boolean;
        approvalStatus: string | null;
        resultStatus: McpResultStatus | null;
        errorCode: string | null;
        createdAt: string;
        updatedAt: string;
      };
    }
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

export function validateMcpIntentInput(
  body: unknown,
): { ok: true; input: McpIntentInput } | { ok: false; error: string } {
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

  const status = body.status;
  if (
    typeof status !== "string" ||
    !(MCP_INTENT_STATUSES as readonly string[]).includes(status)
  ) {
    return { ok: false, error: "status is invalid." };
  }

  const riskLevel = body.riskLevel;
  if (
    typeof riskLevel !== "string" ||
    !(MCP_RISK_LEVELS as readonly string[]).includes(riskLevel)
  ) {
    return { ok: false, error: "riskLevel is invalid." };
  }

  const policyErr = nonEmptyString(body.policyDecision, "policyDecision");
  if (policyErr) return { ok: false, error: policyErr };

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

  const input: McpIntentInput = {
    tool: (body.tool as string).trim(),
    intentClass: intentClass as McpIntentClass,
    status: status as McpIntentStatus,
    riskLevel: riskLevel as McpRiskLevel,
    policyDecision: (body.policyDecision as string).trim(),
    requestSummary: body.requestSummary,
    ...(typeof body.requiresApproval === "boolean"
      ? { requiresApproval: body.requiresApproval }
      : {}),
    ...(optionalString(body.approvalStatus) != null
      ? { approvalStatus: optionalString(body.approvalStatus) }
      : {}),
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
    ...(optionalString(body.resultStatus) != null &&
    (body.resultStatus === "ok" || body.resultStatus === "error")
      ? { resultStatus: body.resultStatus as McpResultStatus }
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

export async function resolveOwnedProjectId(
  db: SystemDb,
  userId: string,
  projectHash: string | null | undefined,
  projectId: string | null | undefined,
): Promise<{ ok: true; projectId: string | null } | { ok: false; status: number; error: string }> {
  if (!projectHash && !projectId) {
    return { ok: true, projectId: null };
  }

  if (projectHash) {
    const h = projectHash.trim().toLowerCase();
    if (!/^[a-f0-9]{7}$/u.test(h)) {
      return { ok: false, status: 400, error: "projectHash must be a 7-char hex id." };
    }
    const [row] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.userId, userId), eq(projects.hash, h)))
      .limit(1);
    if (!row) {
      return { ok: false, status: 404, error: "Project not found." };
    }
    return { ok: true, projectId: row.id };
  }

  if (projectId) {
    const [row] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.userId, userId), eq(projects.id, projectId)))
      .limit(1);
    if (!row) {
      return { ok: false, status: 404, error: "Project not found." };
    }
    return { ok: true, projectId: row.id };
  }

  return { ok: true, projectId: null };
}

export async function insertMcpIntent(
  db: SystemDb,
  auth: { userId: string; keyId: string },
  input: McpIntentInput,
  resolvedProjectId: string | null,
): Promise<McpIntentInsertResult> {
  const now = new Date();
  const [row] = await db
    .insert(mcpIntents)
    .values({
      userId: auth.userId,
      keyId: auth.keyId,
      projectId: resolvedProjectId ?? input.projectId ?? null,
      projectHash: input.projectHash ?? null,
      tool: input.tool,
      intentClass: input.intentClass,
      status: input.status,
      riskLevel: input.riskLevel,
      planId: input.planId ?? null,
      planHash: input.planHash ?? null,
      requestSummary: input.requestSummary,
      policyDecision: input.policyDecision,
      requiresApproval: input.requiresApproval ?? false,
      approvalStatus: input.approvalStatus ?? null,
      resultStatus: input.resultStatus ?? null,
      errorCode: input.errorCode ?? null,
      metadata: input.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: mcpIntents.id, status: mcpIntents.status });

  if (!row) {
    return { ok: false, status: 500, error: "Failed to record intent." };
  }
  return {
    ok: true,
    intentId: row.id,
    status: row.status as McpIntentStatus,
  };
}

export async function getMcpIntentById(
  db: SystemDb,
  auth: { userId: string },
  intentId: string,
): Promise<McpIntentGetResult> {
  const id = intentId.trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return { ok: false, status: 400, error: "Invalid intent id." };
  }

  const [row] = await db
    .select({
      id: mcpIntents.id,
      status: mcpIntents.status,
      tool: mcpIntents.tool,
      intentClass: mcpIntents.intentClass,
      riskLevel: mcpIntents.riskLevel,
      projectHash: mcpIntents.projectHash,
      planId: mcpIntents.planId,
      planHash: mcpIntents.planHash,
      policyDecision: mcpIntents.policyDecision,
      requiresApproval: mcpIntents.requiresApproval,
      approvalStatus: mcpIntents.approvalStatus,
      resultStatus: mcpIntents.resultStatus,
      errorCode: mcpIntents.errorCode,
      createdAt: mcpIntents.createdAt,
      updatedAt: mcpIntents.updatedAt,
    })
    .from(mcpIntents)
    .where(and(eq(mcpIntents.id, id), eq(mcpIntents.userId, auth.userId)))
    .limit(1);

  if (!row) {
    return { ok: false, status: 404, error: "Intent not found." };
  }

  return {
    ok: true,
    intent: {
      intentId: row.id,
      status: row.status as McpIntentStatus,
      tool: row.tool,
      intentClass: row.intentClass as McpIntentClass,
      riskLevel: row.riskLevel as McpRiskLevel,
      projectHash: row.projectHash,
      planId: row.planId,
      planHash: row.planHash,
      policyDecision: row.policyDecision,
      requiresApproval: row.requiresApproval,
      approvalStatus: row.approvalStatus,
      resultStatus: row.resultStatus as McpResultStatus | null,
      errorCode: row.errorCode,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
  };
}

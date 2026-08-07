/**
 * MCP intent validation + persistence for POST/GET /api/cli/v1/intents.
 */

import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { mcpIntents, projects } from "@/src/db/schema";
import type { SystemDb } from "@/src/lib/db";
import {
  MCP_INTENT_CLASSES,
  type McpIntentClass,
  type McpResultStatus,
} from "./mcp-audit";
import type { ControlPlaneAuth } from "./control-plane-auth";
import { controlPlaneAuthIdentity, mergeControlPlaneAuthMetadata } from "./control-plane-auth";
import { containsObviousSecret } from "./mcp-secret-scan";
import {
  sanitizeMcpIntentRow,
  type SanitizedMcpIntent,
} from "./mcp-intent-sanitize";

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

export const MCP_INTENT_LIST_DEFAULT_LIMIT = 50;
export const MCP_INTENT_LIST_MAX_LIMIT = 200;

export interface ListMcpIntentsFilters {
  projectHash?: string;
  tool?: string;
  status?: McpIntentStatus;
  intentClass?: McpIntentClass;
  riskLevel?: McpRiskLevel;
  limit: number;
  cursor?: string;
}

export interface ListMcpIntentsResult {
  intents: SanitizedMcpIntent[];
  nextCursor?: string;
}

export function encodeIntentListCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

export function decodeIntentListCursor(
  cursor: string,
): { createdAt: Date; id: string } | null {
  try {
    const decoded = Buffer.from(cursor.trim(), "base64url").toString("utf8");
    const sep = decoded.lastIndexOf("|");
    if (sep < 0) return null;
    const iso = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime())) return null;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

function parsePositiveInt(value: string | null, fallback: number): number | null {
  if (value === null || value.trim() === "") return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

export function parseListMcpIntentsQuery(
  searchParams: URLSearchParams,
): { ok: true; filters: ListMcpIntentsFilters } | { ok: false; error: string } {
  const projectHashRaw = searchParams.get("projectHash")?.trim();
  let projectHash: string | undefined;
  if (projectHashRaw) {
    const h = projectHashRaw.toLowerCase();
    if (!/^[a-f0-9]{7}$/u.test(h)) {
      return { ok: false, error: "projectHash must be a 7-char hex id." };
    }
    projectHash = h;
  }

  const toolRaw = searchParams.get("tool")?.trim();
  const tool = toolRaw && toolRaw.length > 0 ? toolRaw.slice(0, 128) : undefined;

  const statusRaw = searchParams.get("status")?.trim();
  let status: McpIntentStatus | undefined;
  if (statusRaw) {
    if (!(MCP_INTENT_STATUSES as readonly string[]).includes(statusRaw)) {
      return { ok: false, error: "status is invalid." };
    }
    status = statusRaw as McpIntentStatus;
  }

  const intentClassRaw = searchParams.get("intentClass")?.trim();
  let intentClass: McpIntentClass | undefined;
  if (intentClassRaw) {
    if (!(MCP_INTENT_CLASSES as readonly string[]).includes(intentClassRaw)) {
      return { ok: false, error: "intentClass is invalid." };
    }
    intentClass = intentClassRaw as McpIntentClass;
  }

  const riskLevelRaw = searchParams.get("riskLevel")?.trim();
  let riskLevel: McpRiskLevel | undefined;
  if (riskLevelRaw) {
    if (!(MCP_RISK_LEVELS as readonly string[]).includes(riskLevelRaw)) {
      return { ok: false, error: "riskLevel is invalid." };
    }
    riskLevel = riskLevelRaw as McpRiskLevel;
  }

  const limitParsed = parsePositiveInt(searchParams.get("limit"), MCP_INTENT_LIST_DEFAULT_LIMIT);
  if (limitParsed === null) {
    return { ok: false, error: "limit must be a positive integer." };
  }
  const limit = Math.min(limitParsed, MCP_INTENT_LIST_MAX_LIMIT);

  const cursorRaw = searchParams.get("cursor")?.trim() ?? searchParams.get("before")?.trim();
  if (cursorRaw) {
    if (!decodeIntentListCursor(cursorRaw)) {
      return { ok: false, error: "cursor is invalid." };
    }
  }

  return {
    ok: true,
    filters: {
      ...(projectHash ? { projectHash } : {}),
      ...(tool ? { tool } : {}),
      ...(status ? { status } : {}),
      ...(intentClass ? { intentClass } : {}),
      ...(riskLevel ? { riskLevel } : {}),
      limit,
      ...(cursorRaw ? { cursor: cursorRaw } : {}),
    },
  };
}

export async function listMcpIntentsForUser(
  db: SystemDb,
  userId: string,
  filters: ListMcpIntentsFilters,
  options?: { allowedProjectIds?: readonly string[] | null },
): Promise<
  | { ok: true; result: ListMcpIntentsResult }
  | { ok: false; status: number; error: string }
> {
  const conditions = [eq(mcpIntents.userId, userId)];

  if (options?.allowedProjectIds) {
    const allowed = options.allowedProjectIds.filter(Boolean);
    if (allowed.length === 0) {
      return { ok: true, result: { intents: [] } };
    }
    conditions.push(
      or(isNull(mcpIntents.projectId), inArray(mcpIntents.projectId, [...allowed]))!,
    );
  }

  if (filters.projectHash) {
    conditions.push(eq(mcpIntents.projectHash, filters.projectHash));
  }
  if (filters.tool) {
    conditions.push(eq(mcpIntents.tool, filters.tool));
  }
  if (filters.status) {
    conditions.push(eq(mcpIntents.status, filters.status));
  }
  if (filters.intentClass) {
    conditions.push(eq(mcpIntents.intentClass, filters.intentClass));
  }
  if (filters.riskLevel) {
    conditions.push(eq(mcpIntents.riskLevel, filters.riskLevel));
  }

  if (filters.cursor) {
    const decoded = decodeIntentListCursor(filters.cursor);
    if (!decoded) {
      return { ok: false, status: 400, error: "cursor is invalid." };
    }
    conditions.push(
      or(
        lt(mcpIntents.createdAt, decoded.createdAt),
        and(eq(mcpIntents.createdAt, decoded.createdAt), lt(mcpIntents.id, decoded.id)),
      )!,
    );
  }

  const rows = await db
    .select({
      id: mcpIntents.id,
      createdAt: mcpIntents.createdAt,
      updatedAt: mcpIntents.updatedAt,
      projectHash: mcpIntents.projectHash,
      tool: mcpIntents.tool,
      intentClass: mcpIntents.intentClass,
      status: mcpIntents.status,
      riskLevel: mcpIntents.riskLevel,
      policyDecision: mcpIntents.policyDecision,
      approvalStatus: mcpIntents.approvalStatus,
      resultStatus: mcpIntents.resultStatus,
      errorCode: mcpIntents.errorCode,
      planId: mcpIntents.planId,
      planHash: mcpIntents.planHash,
      requestSummary: mcpIntents.requestSummary,
      metadata: mcpIntents.metadata,
    })
    .from(mcpIntents)
    .where(and(...conditions))
    .orderBy(desc(mcpIntents.createdAt), desc(mcpIntents.id))
    .limit(filters.limit + 1);

  const page = rows.slice(0, filters.limit);
  const intents = page.map((row) =>
    sanitizeMcpIntentRow({
      ...row,
      requestSummary: row.requestSummary as Record<string, unknown>,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    }),
  );

  let nextCursor: string | undefined;
  if (rows.length > filters.limit) {
    const last = page[page.length - 1]!;
    nextCursor = encodeIntentListCursor(last.createdAt, last.id);
  }

  return { ok: true, result: { intents, ...(nextCursor ? { nextCursor } : {}) } };
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
  auth: ControlPlaneAuth,
  input: McpIntentInput,
  resolvedProjectId: string | null,
): Promise<McpIntentInsertResult> {
  const identity = controlPlaneAuthIdentity(auth);
  const metadata = mergeControlPlaneAuthMetadata(auth, input.metadata);
  const now = new Date();
  const [row] = await db
    .insert(mcpIntents)
    .values({
      userId: identity.userId,
      keyId: identity.keyId,
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
      metadata,
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
  options?: { allowedProjectIds?: readonly string[] | null },
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
      projectId: mcpIntents.projectId,
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

  if (options?.allowedProjectIds && row.projectId) {
    if (!options.allowedProjectIds.includes(row.projectId)) {
      return { ok: false, status: 403, error: "Intent is outside MCP token scope." };
    }
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

export interface McpIntentUpdateInput {
  status: McpIntentStatus;
  resultStatus?: McpResultStatus | null;
  errorCode?: string | null;
  metadata?: Record<string, unknown> | null;
  policyDecision?: string;
}

export type McpIntentUpdateResult =
  | { ok: true; intentId: string; status: McpIntentStatus }
  | { ok: false; status: number; error: string };

export function validateMcpIntentUpdateInput(
  body: unknown,
): { ok: true; input: McpIntentUpdateInput } | { ok: false; error: string } {
  if (!isRecord(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const status = body.status;
  if (
    typeof status !== "string" ||
    !(MCP_INTENT_STATUSES as readonly string[]).includes(status)
  ) {
    return { ok: false, error: "status is invalid." };
  }

  const metadataRaw = body.metadata;
  let metadata: Record<string, unknown> | null | undefined;
  if (metadataRaw === undefined) {
    metadata = undefined;
  } else if (metadataRaw === null) {
    metadata = null;
  } else if (!isRecord(metadataRaw)) {
    return { ok: false, error: "metadata must be a JSON object when provided." };
  } else {
    metadata = metadataRaw;
  }

  const resultStatusRaw = body.resultStatus;
  let resultStatus: McpResultStatus | null | undefined;
  if (resultStatusRaw === undefined) {
    resultStatus = undefined;
  } else if (resultStatusRaw === null) {
    resultStatus = null;
  } else if (resultStatusRaw === "ok" || resultStatusRaw === "error") {
    resultStatus = resultStatusRaw;
  } else {
    return { ok: false, error: "resultStatus must be ok, error, or null." };
  }

  const policyDecision = optionalString(body.policyDecision);
  const input: McpIntentUpdateInput = {
    status: status as McpIntentStatus,
    ...(resultStatus !== undefined ? { resultStatus } : {}),
    ...(optionalString(body.errorCode) != null
      ? { errorCode: optionalString(body.errorCode) }
      : body.errorCode === null
        ? { errorCode: null }
        : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    ...(policyDecision != null ? { policyDecision } : {}),
  };

  if (metadata !== undefined && metadata !== null && containsObviousSecret(metadata)) {
    return { ok: false, error: "metadata contains obvious secret material." };
  }

  return { ok: true, input };
}

export async function updateMcpIntentById(
  db: SystemDb,
  auth: { userId: string },
  intentId: string,
  input: McpIntentUpdateInput,
  options?: { allowedProjectIds?: readonly string[] | null },
): Promise<McpIntentUpdateResult> {
  const id = intentId.trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return { ok: false, status: 400, error: "Invalid intent id." };
  }

  if (options?.allowedProjectIds) {
    const existing = await getMcpIntentById(db, auth, id, options);
    if (!existing.ok) {
      return { ok: false, status: existing.status, error: existing.error };
    }
  }

  const now = new Date();
  const patch: Partial<typeof mcpIntents.$inferInsert> = {
    status: input.status,
    updatedAt: now,
    ...(input.resultStatus !== undefined ? { resultStatus: input.resultStatus } : {}),
    ...(input.errorCode !== undefined ? { errorCode: input.errorCode } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    ...(input.policyDecision !== undefined ? { policyDecision: input.policyDecision } : {}),
  };

  const [row] = await db
    .update(mcpIntents)
    .set(patch)
    .where(and(eq(mcpIntents.id, id), eq(mcpIntents.userId, auth.userId)))
    .returning({ id: mcpIntents.id, status: mcpIntents.status });

  if (!row) {
    return { ok: false, status: 404, error: "Intent not found." };
  }

  return {
    ok: true,
    intentId: row.id,
    status: row.status as McpIntentStatus,
  };
}

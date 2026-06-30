import type { ApiClientContext } from "./context";
import type { McpIntentClass, McpResultStatus } from "./mcp-audit";
import {
  parseJsonResponseBody,
  throwIfNotOkDescribeFailed,
} from "./json-response";

export type McpIntentStatus = "pending" | "completed" | "failed" | "denied";
export type McpRiskLevel = "low" | "medium" | "sensitive" | "destructive";

export interface CreateMcpIntentInput {
  tool: string;
  intentClass: McpIntentClass;
  status: McpIntentStatus;
  riskLevel: McpRiskLevel;
  planId?: string;
  planHash?: string;
  projectHash?: string;
  projectId?: string;
  requestSummary: Record<string, unknown>;
  policyDecision: string;
  requiresApproval?: boolean;
  approvalStatus?: string;
  resultStatus?: McpResultStatus;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateMcpIntentResult {
  intentId: string;
  status: McpIntentStatus;
}

export interface UpdateMcpIntentInput {
  status: McpIntentStatus;
  resultStatus?: McpResultStatus | null;
  errorCode?: string | null;
  metadata?: Record<string, unknown> | null;
  policyDecision?: string;
}

export interface UpdateMcpIntentResult {
  intentId: string;
  status: McpIntentStatus;
}

export interface McpIntentDetail {
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
}

export async function createMcpIntent(
  ctx: ApiClientContext,
  input: CreateMcpIntentInput,
): Promise<CreateMcpIntentResult> {
  const token = ctx.tokenOrThrow();
  const url = `${ctx.baseUrl}/cli/v1/intents`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  const body = parseJsonResponseBody(
    text,
    `MCP intent: response was not JSON (${res.status}).`,
  );
  throwIfNotOkDescribeFailed(res, body, text);
  if (
    !body ||
    typeof body !== "object" ||
    !("intentId" in body) ||
    typeof (body as { intentId: unknown }).intentId !== "string" ||
    !("status" in body) ||
    typeof (body as { status: unknown }).status !== "string"
  ) {
    throw new Error("MCP intent: response missing intentId/status.");
  }
  return {
    intentId: (body as { intentId: string }).intentId,
    status: (body as { status: McpIntentStatus }).status,
  };
}

export async function getMcpIntent(
  ctx: ApiClientContext,
  intentId: string,
): Promise<McpIntentDetail> {
  const token = ctx.tokenOrThrow();
  const id = intentId.trim();
  const url = `${ctx.baseUrl}/cli/v1/intents/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  const body = parseJsonResponseBody(
    text,
    `MCP intent get: response was not JSON (${res.status}).`,
  );
  throwIfNotOkDescribeFailed(res, body, text);
  if (!body || typeof body !== "object") {
    throw new Error("MCP intent get: empty response.");
  }
  return body as McpIntentDetail;
}

export async function updateMcpIntent(
  ctx: ApiClientContext,
  intentId: string,
  input: UpdateMcpIntentInput,
): Promise<UpdateMcpIntentResult> {
  const token = ctx.tokenOrThrow();
  const id = intentId.trim();
  const url = `${ctx.baseUrl}/cli/v1/intents/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  const body = parseJsonResponseBody(
    text,
    `MCP intent update: response was not JSON (${res.status}).`,
  );
  throwIfNotOkDescribeFailed(res, body, text);
  if (
    !body ||
    typeof body !== "object" ||
    !("intentId" in body) ||
    typeof (body as { intentId: unknown }).intentId !== "string" ||
    !("status" in body) ||
    typeof (body as { status: unknown }).status !== "string"
  ) {
    throw new Error("MCP intent update: response missing intentId/status.");
  }
  return {
    intentId: (body as { intentId: string }).intentId,
    status: (body as { status: McpIntentStatus }).status,
  };
}

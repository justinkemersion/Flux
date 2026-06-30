import type { ApiClientContext } from "./context";
import {
  errorMessageFromJsonBody,
  parseJsonResponseBody,
  throwIfNotOkDescribeFailed,
} from "./json-response";

export type McpAuditDecision = "allow" | "deny";
export type McpIntentClass =
  | "read"
  | "plan"
  | "preflight"
  | "credential"
  | "protective_mutation"
  | "write"
  | "destructive";
export type McpResultStatus = "ok" | "error";

export interface RecordMcpAuditEventInput {
  tool: string;
  intentClass: McpIntentClass;
  decision: McpAuditDecision;
  gate?: string;
  planId?: string;
  planHash?: string;
  projectHash?: string;
  projectId?: string;
  requestSummary: Record<string, unknown>;
  resultStatus: McpResultStatus;
  errorCode?: string;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

export interface RecordMcpAuditEventResult {
  ok: true;
  auditId: string;
}

export async function recordMcpAuditEvent(
  ctx: ApiClientContext,
  input: RecordMcpAuditEventInput,
): Promise<RecordMcpAuditEventResult> {
  const token = ctx.tokenOrThrow();
  const url = `${ctx.baseUrl}/cli/v1/audit`;
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
    `MCP audit: response was not JSON (${res.status}).`,
  );
  throwIfNotOkDescribeFailed(res, body, text);
  if (
    !body ||
    typeof body !== "object" ||
    !("auditId" in body) ||
    typeof (body as { auditId: unknown }).auditId !== "string"
  ) {
    throw new Error("MCP audit: response missing auditId.");
  }
  return { ok: true, auditId: (body as { auditId: string }).auditId };
}

/** Surface API error text without wrapping (for non-fatal read-tool warnings). */
export function mcpAuditFailureMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function recordMcpAuditEventBestEffort(
  ctx: ApiClientContext,
  input: RecordMcpAuditEventInput,
): Promise<{ persisted: boolean; error?: string }> {
  try {
    await recordMcpAuditEvent(ctx, input);
    return { persisted: true };
  } catch (err) {
    return { persisted: false, error: mcpAuditFailureMessage(err) };
  }
}

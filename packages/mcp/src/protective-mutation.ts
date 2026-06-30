/**
 * Phase 3B protective-mutation pre/post gates (ledger before side effect).
 */

import type {
  CreateMcpIntentInput,
  UpdateMcpIntentInput,
} from "@flux/cli/api-client";
import {
  projectHashFromArgs,
  requestSummaryFromArgs,
  type McpPersistenceClient,
} from "./audit-pipeline";
import type { ToolDef } from "./tools";
import type { ToolResult } from "./result";
import {
  backupEnsureAuditGate,
  isBackupEnsureOperationSuccessful,
  type BackupEnsureData,
} from "./tools/backup-ensure";
import { sanitizeBackupMetadata } from "./tools/backup-sanitize";

export interface ProtectivePersistenceClient extends McpPersistenceClient {
  updateMcpIntent(
    intentId: string,
    input: UpdateMcpIntentInput,
  ): Promise<{ intentId: string; status: string }>;
}

export function isProtectivePersistenceAvailable(
  client: FluxToolClientLike,
): client is ProtectivePersistenceClient {
  return (
    typeof client.recordMcpAuditEvent === "function" &&
    typeof client.createMcpIntent === "function" &&
    typeof client.updateMcpIntent === "function"
  );
}

interface FluxToolClientLike {
  recordMcpAuditEvent?: unknown;
  createMcpIntent?: unknown;
  updateMcpIntent?: unknown;
}

export async function createPendingProtectiveIntent(
  client: ProtectivePersistenceClient,
  def: ToolDef,
  args: Record<string, unknown>,
): Promise<{ intentId: string }> {
  const projectHash = projectHashFromArgs(args);
  const payload: CreateMcpIntentInput = {
    tool: def.name,
    intentClass: "protective_mutation",
    status: "pending",
    riskLevel: "low",
    policyDecision: "allow",
    requestSummary: requestSummaryFromArgs(args),
    ...(projectHash ? { projectHash } : {}),
  };
  const created = await client.createMcpIntent(payload);
  return { intentId: created.intentId };
}

function intentMetadataFromResult(result: ToolResult): Record<string, unknown> | undefined {
  if (!result.data || typeof result.data !== "object") return undefined;
  const data = result.data as BackupEnsureData;
  return sanitizeBackupMetadata({
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

export async function updateProtectiveIntentTerminal(
  client: ProtectivePersistenceClient,
  intentId: string,
  result: ToolResult,
  errorCode?: string,
): Promise<void> {
  const status = result.ok ? "completed" : "failed";
  const metadata = intentMetadataFromResult(result) ?? null;
  const patch: UpdateMcpIntentInput = {
    status,
    resultStatus: result.ok ? "ok" : "error",
    ...(errorCode !== undefined ? { errorCode } : {}),
    metadata,
  };
  await client.updateMcpIntent(intentId, patch);
}

export function intentFinalizationFailureResult(
  handlerResult: ToolResult,
  intentId: string,
): ToolResult {
  const data =
    handlerResult.data && typeof handlerResult.data === "object"
      ? { ...(handlerResult.data as Record<string, unknown>), intentId }
      : { intentId };

  return {
    ok: false,
    summary:
      "Backup operation completed but MCP intent finalization failed; inspect audit/intent state on the control plane.",
    data,
    remediation:
      "The backup may be restore-verified, but the MCP control loop did not finish. Inspect persisted intent and audit rows before treating this as success.",
  };
}

export function backupEnsureGateFromResult(result: ToolResult): string {
  return backupEnsureAuditGate(result);
}

export { isBackupEnsureOperationSuccessful };

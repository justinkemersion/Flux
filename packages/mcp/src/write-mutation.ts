/**
 * Phase 4 write-mutation pre/post gates (ledger before schema apply).
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
  migrationApplyAuditGate,
  type MigrationApplyFailureData,
  type MigrationApplySuccessData,
  validateStoredPlanForApply,
} from "./tools/migration-apply";

export interface WritePersistenceClient extends McpPersistenceClient {
  updateMcpIntent(
    intentId: string,
    input: UpdateMcpIntentInput,
  ): Promise<{ intentId: string; status: string }>;
}

export function isWritePersistenceAvailable(
  client: FluxToolClientLike,
): client is WritePersistenceClient {
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

export interface MigrationApplyPlanContext {
  stored: import("./plan-store").StoredMigrationPlan;
  migrationsDir: string;
}

export async function validateMigrationApplyPlan(
  args: Record<string, unknown>,
): Promise<
  | { ok: true; context: MigrationApplyPlanContext }
  | { ok: false; result: ToolResult; gate: string }
> {
  const hash = typeof args.hash === "string" ? args.hash.trim() : "";
  const planId = typeof args.planId === "string" ? args.planId.trim() : "";
  const planHash = typeof args.planHash === "string" ? args.planHash.trim() : "";
  const migrationsPath =
    typeof args.migrationsPath === "string" ? args.migrationsPath.trim() : "";
  const workspaceRoot =
    typeof args.workspaceRoot === "string" ? args.workspaceRoot : undefined;

  if (!hash || !planId || !planHash || !migrationsPath) {
    return {
      ok: false,
      gate: "migration_apply_blocked_stale_plan",
      result: {
        ok: false,
        summary: "hash, planId, planHash, and migrationsPath are required.",
        data: null,
        remediation: "Re-run flux.migration.plan and submit the returned planId/planHash.",
      },
    };
  }

  const validation = await validateStoredPlanForApply({
    hash,
    planId,
    planHash,
    migrationsPath,
    ...(workspaceRoot ? { workspaceRoot } : {}),
  });

  if (!validation.ok) {
    return {
      ok: false,
      gate: validation.gate,
      result: {
        ok: false,
        summary: validation.summary,
        data: { gate: validation.gate },
        remediation: validation.remediation,
      },
    };
  }

  return {
    ok: true,
    context: {
      stored: validation.stored,
      migrationsDir: validation.migrationsDir,
    },
  };
}

export async function createPendingWriteIntent(
  client: WritePersistenceClient,
  def: ToolDef,
  args: Record<string, unknown>,
  plan: MigrationApplyPlanContext,
): Promise<{ intentId: string }> {
  const projectHash = projectHashFromArgs(args);
  const planId = typeof args.planId === "string" ? args.planId.trim() : undefined;
  const planHash = typeof args.planHash === "string" ? args.planHash.trim() : undefined;
  const riskLevel = plan.stored.destructiveShaped ? "destructive" : "medium";

  const payload: CreateMcpIntentInput = {
    tool: def.name,
    intentClass: "write",
    status: "pending",
    riskLevel,
    policyDecision: "allow",
    requestSummary: requestSummaryFromArgs(args),
    ...(projectHash ? { projectHash } : {}),
    ...(planId ? { planId } : {}),
    ...(planHash ? { planHash } : {}),
    metadata: {
      applyCount: plan.stored.apply.length,
      destructiveShaped: plan.stored.destructiveShaped,
    },
  };
  const created = await client.createMcpIntent(payload);
  return { intentId: created.intentId };
}

function intentMetadataFromResult(result: ToolResult): Record<string, unknown> | undefined {
  if (!result.data || typeof result.data !== "object") return undefined;
  const data = result.data as MigrationApplySuccessData | MigrationApplyFailureData;
  return {
    planHash: data.planHash,
    appliedCount: data.appliedCount,
    appliedFiles: data.appliedFiles,
    destructiveShaped: data.destructiveShaped,
    ...(data.backupTrustTier !== undefined ? { backupTrustTier: data.backupTrustTier } : {}),
    ...("failedFile" in data && data.failedFile !== undefined
      ? { failedFile: data.failedFile }
      : {}),
  };
}

export async function updateWriteIntentTerminal(
  client: WritePersistenceClient,
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

export function writeIntentFinalizationFailureResult(
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
      "Migration apply completed but MCP intent finalization failed; inspect audit/intent state on the control plane.",
    data,
    remediation:
      "Migrations may have been applied, but the MCP control loop did not finish. Inspect persisted intent and audit rows before treating this as success.",
  };
}

export function migrationApplyGateFromResult(result: ToolResult): string {
  return migrationApplyAuditGate(result);
}

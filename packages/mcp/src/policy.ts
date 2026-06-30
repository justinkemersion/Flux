/**
 * Tool intent classification and the non-mutation safety policy.
 *
 * Through Phase 3A the server exposed only non-mutating tools:
 *   - `read`       — pure reads (list/describe/inspect/doctor/activity, bounded readonly query).
 *   - `preflight`  — destructive-gate checks (no mutation).
 *   - `plan`       — migration planning (no apply).
 *   - `credential` — issuing a short-lived, readonly, v2-only DB credential.
 *
 * Phase 3B adds `protective_mutation` for a single allowlisted tool
 * (`flux.backup.ensureVerified`). Schema/data `write` and `destructive` intents
 * remain forbidden until Phase 4.
 *
 * Phase 3A adds the "ledger before loaded gun" rule: future write/destructive tools
 * require persisted audit availability (and intents/planId/backup trust as applicable).
 */

export type IntentClass =
  | "read"
  | "preflight"
  | "plan"
  | "credential"
  | "protective_mutation"
  | "write"
  | "destructive";

const NON_MUTATING_INTENTS: ReadonlySet<IntentClass> = new Set<IntentClass>([
  "read",
  "preflight",
  "plan",
  "credential",
]);

const MUTATING_INTENTS: ReadonlySet<IntentClass> = new Set<IntentClass>([
  "write",
  "destructive",
]);

/** Phase 3B: only these tools may register as `protective_mutation`. */
export const PHASE_3B_PROTECTIVE_TOOLS = new Set(["flux.backup.ensureVerified"]);

/** Tools that create durable intents in Phase 3A+ (post-hoc or pre-exec). */
const INTENT_TRACKED_TOOL_NAMES = new Set([
  "flux.migration.plan",
  "flux.credentials.temporary",
  "flux.query.readonly",
  "flux.destructive.preflight",
  "flux.backup.ensureVerified",
]);

export function isNonMutatingIntent(intent: IntentClass): boolean {
  return NON_MUTATING_INTENTS.has(intent);
}

export function isProtectiveMutationIntent(intent: IntentClass): boolean {
  return intent === "protective_mutation";
}

export function isMutatingIntent(intent: IntentClass): boolean {
  return MUTATING_INTENTS.has(intent);
}

export function isAllowedRegistration(
  intentClass: IntentClass,
  toolName: string,
): boolean {
  if (NON_MUTATING_INTENTS.has(intentClass)) return true;
  if (intentClass === "protective_mutation") {
    return PHASE_3B_PROTECTIVE_TOOLS.has(toolName);
  }
  return false;
}

export function isIntentTrackedTool(toolName: string): boolean {
  return INTENT_TRACKED_TOOL_NAMES.has(toolName);
}

/** Protective/write/destructive tool calls must persist audit (enforced in pipeline). */
export function auditPersistenceRequired(intent: IntentClass): boolean {
  return isMutatingIntent(intent) || isProtectiveMutationIntent(intent);
}

export interface WriteDestructiveGateInput {
  intentClass: IntentClass;
  auditAvailable: boolean;
  intentRecorded?: boolean;
  planId?: string;
  backupTrustPass?: boolean;
}

export type WriteDestructiveGateResult =
  | { allowed: true }
  | { allowed: false; reason: string };

export interface ProtectiveMutationGateInput {
  auditAvailable: boolean;
  intentRecorded: boolean;
}

/**
 * Policy gate for Phase 3B protective mutation tools.
 * Call **after** a pending intent is persisted (`intentRecorded: true`).
 */
export function assertProtectiveMutationPolicy(
  input: ProtectiveMutationGateInput,
): WriteDestructiveGateResult {
  if (!input.auditAvailable) {
    return {
      allowed: false,
      reason:
        "Persistent MCP audit is unavailable; protective mutation tools are blocked.",
    };
  }

  if (!input.intentRecorded) {
    return {
      allowed: false,
      reason:
        "A persisted MCP intent is required before protective mutation execution.",
    };
  }

  return { allowed: true };
}

/**
 * Policy gate for future write/destructive MCP tools (Phase 4+).
 */
export function assertWriteDestructivePolicy(
  input: WriteDestructiveGateInput,
): WriteDestructiveGateResult {
  if (!isMutatingIntent(input.intentClass)) {
    return { allowed: true };
  }

  if (!input.auditAvailable) {
    return {
      allowed: false,
      reason: "Persistent MCP audit is unavailable; write/destructive tools are blocked.",
    };
  }

  if (!input.intentRecorded) {
    return {
      allowed: false,
      reason: "A persisted MCP intent is required before write/destructive execution.",
    };
  }

  if (input.intentClass === "write" && !input.planId?.trim()) {
    return {
      allowed: false,
      reason: "Write tools require a valid planId from a prior flux.migration.plan intent.",
    };
  }

  if (input.intentClass === "destructive" && input.backupTrustPass !== true) {
    return {
      allowed: false,
      reason: "Destructive tools require backup trust pass from flux.destructive.preflight.",
    };
  }

  return { allowed: true };
}

/** @deprecated Use `assertRegisteredToolsPolicy`. Kept as alias for tests. */
export function assertNonMutatingTools(
  defs: ReadonlyArray<{ name: string; intentClass: IntentClass }>,
): void {
  assertRegisteredToolsPolicy(defs);
}

export function assertRegisteredToolsPolicy(
  defs: ReadonlyArray<{ name: string; intentClass: IntentClass }>,
): void {
  for (const def of defs) {
    if (!isAllowedRegistration(def.intentClass, def.name)) {
      throw new Error(
        `Tool "${def.name}" has intent "${def.intentClass}", which is not permitted in the current MCP phase (read/preflight/plan/credential/protective_mutation allowlist only).`,
      );
    }
  }
}

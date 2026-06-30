/**
 * Tool intent classification and the non-mutation safety policy.
 *
 * Through Phase 3A the server exposes only non-mutating tools:
 *   - `read`       — pure reads (list/describe/inspect/doctor/activity, bounded readonly query).
 *   - `preflight`  — destructive-gate checks (no mutation).
 *   - `plan`       — migration planning (no apply).
 *   - `credential` — issuing a short-lived, readonly, v2-only DB credential.
 *
 * `write` and `destructive` intents remain forbidden (durable mutation is Phase 3B+).
 * `assertNonMutatingTools` fails fast if a forbidden intent is ever registered.
 *
 * Phase 3A adds the "ledger before loaded gun" rule: future write/destructive tools
 * require persisted audit availability (and intents/planId/backup trust as applicable).
 */

export type IntentClass =
  | "read"
  | "preflight"
  | "plan"
  | "credential"
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

/** Tools that create durable intents in Phase 3A. */
const INTENT_TRACKED_TOOL_NAMES = new Set([
  "flux.migration.plan",
  "flux.credentials.temporary",
  "flux.query.readonly",
  "flux.destructive.preflight",
]);

export function isNonMutatingIntent(intent: IntentClass): boolean {
  return NON_MUTATING_INTENTS.has(intent);
}

export function isMutatingIntent(intent: IntentClass): boolean {
  return MUTATING_INTENTS.has(intent);
}

export function isIntentTrackedTool(toolName: string): boolean {
  return INTENT_TRACKED_TOOL_NAMES.has(toolName);
}

/** Write/destructive tool calls must persist audit before execution (enforced in pipeline). */
export function auditPersistenceRequired(intent: IntentClass): boolean {
  return isMutatingIntent(intent);
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

/**
 * Policy gate for future write/destructive MCP tools (Phase 3B+).
 * Phase 3A registers no such tools; this is exercised in tests now.
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

export function assertNonMutatingTools(
  defs: ReadonlyArray<{ name: string; intentClass: IntentClass }>,
): void {
  for (const def of defs) {
    if (!isNonMutatingIntent(def.intentClass)) {
      throw new Error(
        `Tool "${def.name}" has intent "${def.intentClass}", which performs durable mutation and is not permitted before Phase 3B (read/preflight/plan/credential only).`,
      );
    }
  }
}

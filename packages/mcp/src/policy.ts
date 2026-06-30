/**
 * Tool intent classification and the non-mutation safety policy.
 *
 * Through Pass 2 the server exposes only non-mutating tools:
 *   - `read`       — pure reads (list/describe/inspect/doctor/activity, bounded readonly query).
 *   - `preflight`  — destructive-gate checks (no mutation).
 *   - `plan`       — migration planning (no apply).
 *   - `credential` — issuing a short-lived, readonly, v2-only DB credential.
 *
 * `write` and `destructive` intents remain forbidden (durable mutation is Pass 3).
 * `assertNonMutatingTools` fails fast if a forbidden intent is ever registered,
 * so the "no durable mutation" guarantee cannot silently regress.
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

export function isNonMutatingIntent(intent: IntentClass): boolean {
  return NON_MUTATING_INTENTS.has(intent);
}

export function assertNonMutatingTools(
  defs: ReadonlyArray<{ name: string; intentClass: IntentClass }>,
): void {
  for (const def of defs) {
    if (!isNonMutatingIntent(def.intentClass)) {
      throw new Error(
        `Tool "${def.name}" has intent "${def.intentClass}", which performs durable mutation and is not permitted before Pass 3 (read/preflight/plan/credential only).`,
      );
    }
  }
}

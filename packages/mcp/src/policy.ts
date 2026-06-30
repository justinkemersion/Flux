/**
 * Tool intent classification and Pass 1 safety policy.
 *
 * Pass 1 intentionally ships **read** and **preflight** tools only. There are no
 * write, query, migration-apply, or destructive tools yet. `assertPass1Tools`
 * is a guard that fails fast if a non-Pass-1 tool is ever registered, so the
 * read-only guarantee cannot silently regress.
 */

export type IntentClass = "read" | "preflight" | "write" | "destructive";

const PASS_1_INTENTS: ReadonlySet<IntentClass> = new Set<IntentClass>([
  "read",
  "preflight",
]);

export function isAllowedInPass1(intent: IntentClass): boolean {
  return PASS_1_INTENTS.has(intent);
}

export function assertPass1Tools(
  defs: ReadonlyArray<{ name: string; intentClass: IntentClass }>,
): void {
  for (const def of defs) {
    if (!isAllowedInPass1(def.intentClass)) {
      throw new Error(
        `Tool "${def.name}" has intent "${def.intentClass}", which is not permitted in Flux MCP Pass 1 (read/preflight only).`,
      );
    }
  }
}

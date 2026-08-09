/**
 * Canonical contract identifiers shared by the control plane, the gateway and the CLI.
 *
 * These live in `@flux/core` rather than in the package that implements them because the
 * dashboard must report them and the CLI must assert them, and neither depends on
 * `@flux/gateway`. Implementing packages re-export from here so there is one source of truth.
 */

/**
 * Flux gateway public contract version (semver).
 *
 * Downstream doctor/integration tooling (e.g. Flux Foundry) may validate host routing,
 * inbound project JWT requirements, bridge JWT role mapping, and fail-closed anonymous
 * access against this version.
 */
export const FLUX_GATEWAY_CONTRACT_VERSION = "1.0.0";

/**
 * Behavioral contract of the pooled (v2_shared) push SQL adapter.
 *
 * This is the identifier a CLI checks before a pooled production migration, because the
 * adaptation that rewrites tenant SQL runs in the **deployed control plane**, not in the CLI.
 * SHA equality between a local checkout and a deployed dashboard is not required for
 * correctness; agreement on this contract is.
 *
 * History:
 * - `1.x` — plain regex substitution of `authenticated` and `ON SCHEMA public` over the whole
 *   file, including comments, string literals and PL/pgSQL bodies. Withdrawn: it rewrote
 *   non-executable text and could turn `execute format('grant authenticated to %I', …)` into a
 *   tenant-role self-grant.
 * - `2.0.0` — lexically aware adaptation. Rewrites are armed by keywords in real statement
 *   context and applied only to executable tokens; comments, strings, quoted identifiers and
 *   dollar-quoted bodies are skipped. Dynamic DDL must derive the tenant role at runtime.
 *
 * `contract-versions.test.ts` pins this to a digest of the adapter source, so any change to
 * the adapter fails CI until the contract is bumped deliberately.
 */
export const FLUX_POOLED_PUSH_ADAPTER_CONTRACT = "2.0.0";

/** Human-readable invariants for the current pooled-push adaptation contract. */
export const FLUX_POOLED_PUSH_ADAPTER_INVARIANTS = [
  "Adaptation runs over a lexical scan: line comments, nested block comments, single-quoted strings (including '' and E-string escapes), quoted identifiers and dollar-quoted bodies are never rewritten.",
  "Statements are split only on semicolons in code context.",
  "Rewrites are armed by keywords appearing in real statement context and applied only to executable tokens.",
  "Function bodies are not rewritten, so dynamic DDL must derive the tenant role at runtime rather than relying on textual substitution.",
] as const;

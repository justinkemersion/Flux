import type { GauntletMode, GauntletStageName, StageRecord } from "./types";

/**
 * Machine-readable failure reason for reports and AI diagnosis.
 * Distinguishes gauntlet gaps from platform failures — especially on v2_shared.
 */
export type GauntletFailureClass =
  | "unsupported_mode_path"
  | "auth_handshake_mismatch"
  | "probe_model_unimplemented"
  | "platform_failure";

export interface GauntletFailureClassification {
  failureClass: GauntletFailureClass;
  failureClassDetail: string;
}

function firstFailedStage(stages: StageRecord[]): StageRecord | undefined {
  return stages.find((s) => s.status === "failed");
}

function stageErrorText(stage: StageRecord): string {
  return (stage.error?.message ?? stage.summary ?? "").toLowerCase();
}

function isAuthHandshakeSignal(text: string): boolean {
  return (
    /\b401\b/u.test(text) ||
    /invalid or expired token/u.test(text) ||
    /unauthorized/u.test(text) ||
    /auth_handshake/u.test(text)
  );
}

function isUnsupportedPathSignal(text: string): boolean {
  return (
    /unavailable/u.test(text) ||
    /skipped path/u.test(text) ||
    /dashboard base/u.test(text) ||
    /not supported/u.test(text)
  );
}

function isProbeUnimplementedSignal(text: string): boolean {
  return (
    /not implemented/u.test(text) ||
    /probe_model/u.test(text) ||
    /no projectjwt/u.test(text)
  );
}

const V2_HEALTH_STAGES: readonly GauntletStageName[] = [
  "wait_for_health",
  "inspect_schema",
  "api_insert",
  "api_unauth_inert",
  "api_select",
];

const V2_PUSH_STAGES: readonly GauntletStageName[] = ["push_schema"];

/**
 * Classify a failed gauntlet run for stable reporting.
 * v2_shared auth/probe gaps get explicit classes; v1 failures default to platform_failure.
 */
export function classifyGauntletFailure(input: {
  mode: GauntletMode;
  stages: StageRecord[];
  status: "pass" | "fail";
}): GauntletFailureClassification | undefined {
  if (input.status === "pass") return undefined;

  const failed = firstFailedStage(input.stages);
  if (!failed) return undefined;

  const text = stageErrorText(failed);

  if (input.mode === "v2_shared") {
    if (
      V2_HEALTH_STAGES.includes(failed.name) &&
      isAuthHandshakeSignal(text)
    ) {
      return {
        failureClass: "auth_handshake_mismatch",
        failureClassDetail:
          "v2_shared health/API probe returned 401 or token rejection. " +
          "The CLI probe JWT includes the gateway-required stable sub claim, so " +
          "verify the project secret, token lifetime, and deployed gateway contract.",
      };
    }

    if (
      V2_PUSH_STAGES.includes(failed.name) &&
      isUnsupportedPathSignal(text)
    ) {
      return {
        failureClass: "unsupported_mode_path",
        failureClassDetail:
          "v2_shared push or dashboard route was unavailable in this environment. " +
          "Gauntlet intentionally avoids inventing unstable v2 internals.",
      };
    }

    if (isProbeUnimplementedSignal(text)) {
      return {
        failureClass: "probe_model_unimplemented",
        failureClassDetail:
          "v2_shared probe path is not implemented in gauntlet yet " +
          "(missing credentials, profile headers, or dedicated probe helper).",
      };
    }

    // v2 failed for other reasons — still label as platform until probe matures
    return {
      failureClass: "platform_failure",
      failureClassDetail: `v2_shared failed at ${failed.name}: ${failed.error?.message ?? failed.summary ?? "unknown"}`,
    };
  }

  // v1_dedicated: real failures are platform-side unless clearly gauntlet assertion
  return {
    failureClass: "platform_failure",
    failureClassDetail: `v1_dedicated failed at ${failed.name}: ${failed.error?.message ?? failed.summary ?? "unknown"}`,
  };
}

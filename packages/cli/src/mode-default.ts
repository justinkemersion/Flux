import type { CreateProjectMode } from "./api-client";

export function normalizeModeOrThrow(
  mode: string | undefined,
  source: "--mode" | "FLUX_DEFAULT_MODE",
): CreateProjectMode | undefined {
  const value = mode?.trim().toLowerCase();
  if (!value) return undefined;
  if (value === "v1_dedicated" || value === "v2_shared") {
    return value;
  }
  throw new Error(
    `Invalid ${source} "${mode}". Use "v1_dedicated" or "v2_shared".`,
  );
}

/**
 * Modes sent on `flux create` only when the user explicitly requests one.
 * If this returns `undefined`, the control plane picks mode from the live account plan.
 */
export function resolveExplicitCreateMode(input: {
  explicitMode: string | undefined;
  envMode: string | undefined;
}): CreateProjectMode | undefined {
  const fromFlag = normalizeModeOrThrow(input.explicitMode, "--mode");
  if (fromFlag) return fromFlag;
  return normalizeModeOrThrow(input.envMode, "FLUX_DEFAULT_MODE");
}

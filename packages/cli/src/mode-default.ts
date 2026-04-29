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

export function resolveCreateModeFromInputs(input: {
  explicitMode: string | undefined;
  envMode: string | undefined;
  profileDefaultMode: CreateProjectMode | undefined;
}): CreateProjectMode {
  const explicit = normalizeModeOrThrow(input.explicitMode, "--mode");
  if (explicit) return explicit;
  const fromEnv = normalizeModeOrThrow(input.envMode, "FLUX_DEFAULT_MODE");
  if (fromEnv) return fromEnv;
  if (input.profileDefaultMode) return input.profileDefaultMode;
  return "v2_shared";
}

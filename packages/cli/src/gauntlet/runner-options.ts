import type { GauntletRunOptions } from "./types";

export function parseGauntletRuns(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error("--runs must be a positive integer");
  }
  return n;
}

export function resolveGauntletMode(
  value: string | undefined,
): GauntletRunOptions["mode"] {
  const v = (value ?? "v1_dedicated").trim();
  if (v === "v1_dedicated" || v === "v2_shared") return v;
  throw new Error("--mode must be v1_dedicated or v2_shared");
}

import type { GauntletFailureClass } from "./failure-class";
import type { StageStatus } from "./types";

/** Ring 2 scenario identifiers (v1_dedicated only). */
export const MATRIX_SCENARIO_NAMES = [
  "create_duplicate_project",
  "push_invalid_sql",
  "env_set_and_list_redaction",
  "stop_start_project",
  "double_stop_project",
  "missing_project_errors",
  "backup_gate_blocks_destructive_action",
] as const;

export type MatrixScenarioName = (typeof MATRIX_SCENARIO_NAMES)[number];

export interface MatrixStageRecord {
  name: string;
  status: StageStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  summary?: string;
  error?: { message: string; stack?: string };
  artifacts?: Record<string, unknown>;
}

export interface MatrixRunOptions {
  mode: "v1_dedicated";
  reportDir: string;
  prefix: string;
  keepFailed: boolean;
  json: boolean;
  scenario?: MatrixScenarioName;
}

export interface MatrixCommandManifest {
  command: "flux gauntlet matrix";
  argv: string[];
  options: MatrixRunOptions;
  startedAt: string;
}

export interface MatrixScenarioResult {
  scenarioName: MatrixScenarioName;
  mode: "v1_dedicated";
  status: "pass" | "fail" | "skipped";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  stages: MatrixStageRecord[];
  createdProjects: Array<{ slug: string; hash: string }>;
  cleanedUp: boolean;
  cleanupError?: string;
  keptForInspection: boolean;
  reportPath: string;
  failureClass?: GauntletFailureClass;
  failureClassDetail?: string;
  failureAnalysis?: string;
  artifacts?: Record<string, unknown>;
}

export interface MatrixSummary {
  ring: "ring_2_matrix_lite";
  mode: "v1_dedicated";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totalScenarios: number;
  passed: number;
  failed: number;
  skipped: number;
  cleanupLeaks: number;
  scenarios: Array<{
    name: MatrixScenarioName;
    status: MatrixScenarioResult["status"];
    durationMs: number;
    failureClass?: GauntletFailureClass;
    reportPath: string;
  }>;
  reportRoot: string;
}

export function isMatrixScenarioName(value: string): value is MatrixScenarioName {
  return (MATRIX_SCENARIO_NAMES as readonly string[]).includes(value);
}

export function resolveMatrixScenarioNames(
  scenario?: string,
): MatrixScenarioName[] {
  if (!scenario?.trim()) {
    return [...MATRIX_SCENARIO_NAMES];
  }
  const name = scenario.trim();
  if (!isMatrixScenarioName(name)) {
    throw new Error(
      `Unknown matrix scenario "${name}". Valid: ${MATRIX_SCENARIO_NAMES.join(", ")}`,
    );
  }
  return [name];
}

export function assertMatrixModeV1(mode: string | undefined): "v1_dedicated" {
  const v = (mode ?? "v1_dedicated").trim();
  if (v !== "v1_dedicated") {
    throw new Error(
      `Ring 2 matrix is v1_dedicated only (got "${v}"). v2_shared remains parked.`,
    );
  }
  return "v1_dedicated";
}

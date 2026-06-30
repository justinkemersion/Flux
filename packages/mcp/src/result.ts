/**
 * Standard result envelope returned by every Flux MCP tool.
 *
 * `ok` reflects whether the tool ran successfully — not the business outcome.
 * For example, `flux.destructive.preflight` returns `ok: true` even when it
 * determines that destructive actions are currently blocked; the block is
 * communicated via `data` + `remediation`.
 */
export interface ToolResult<T = unknown> {
  ok: boolean;
  summary: string;
  data: T;
  remediation?: string;
}

export function ok<T>(summary: string, data: T, remediation?: string): ToolResult<T> {
  return remediation !== undefined
    ? { ok: true, summary, data, remediation }
    : { ok: true, summary, data };
}

export function fail(
  summary: string,
  options?: { remediation?: string; data?: unknown },
): ToolResult {
  const data = options?.data ?? null;
  return options?.remediation !== undefined
    ? { ok: false, summary, data, remediation: options.remediation }
    : { ok: false, summary, data };
}

/** Stable, machine-readable error classification surfaced to agents. */
export type StableErrorCode =
  | "invalid_input"
  | "not_authenticated"
  | "unauthorized"
  | "not_found"
  | "upstream_error";

export interface StableError {
  code: StableErrorCode;
  message: string;
  remediation?: string;
}

/** Thrown by tool handlers for argument validation failures. */
export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidInputError";
  }
}

/**
 * Maps an arbitrary thrown value to a stable, non-leaking error classification.
 * The underlying control-plane client throws human-readable messages; we map
 * the well-known ones to stable codes so agents can branch deterministically.
 */
export function toStableError(err: unknown): StableError {
  if (err instanceof InvalidInputError) {
    return { code: "invalid_input", message: err.message };
  }

  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (lower.includes("not authenticated")) {
    return {
      code: "not_authenticated",
      message,
      remediation: "Set FLUX_API_TOKEN or run `flux login`.",
    };
  }
  if (lower.includes("invalid or expired api token")) {
    return {
      code: "unauthorized",
      message,
      remediation: "Run `flux login` to refresh your API token.",
    };
  }
  if (lower.includes("not found") || lower.includes("(404)")) {
    return { code: "not_found", message };
  }

  return { code: "upstream_error", message };
}

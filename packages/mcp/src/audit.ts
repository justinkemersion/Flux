/**
 * Audit logging for Flux MCP tool calls.
 *
 * Exactly one redacted JSON line is emitted per tool call. Lines are written to
 * **stderr** because stdout is reserved for the MCP stdio transport (writing
 * audit data to stdout would corrupt the protocol stream).
 */

import type { IntentClass } from "./policy";

/** Keys whose values are scrubbed before logging (defense-in-depth). */
const SENSITIVE_KEY_RE =
  /(token|secret|password|passwd|pwd|jwt|authorization|auth|api[_-]?key|anon[_-]?key|service[_-]?role|credential|bearer|\bkey\b|path|artifact|volume|offsite|bucket|signed|url)/i;

const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/;
const CONNECTION_STRING_RE =
  /\b(?:postgres(?:ql)?|mysql|mongodb):\/\/[^\s:@/]+:[^\s@/]+@/i;
const FLX_LIVE_KEY_RE = /\bflx_live_[a-f0-9]{32}_[a-f0-9]{4}\b/i;

const MAX_STRING_LENGTH = 256;
const REDACTED = "[redacted]";

function redactString(value: string): string {
  if (JWT_RE.test(value)) return REDACTED;
  if (CONNECTION_STRING_RE.test(value)) return REDACTED;
  if (FLX_LIVE_KEY_RE.test(value)) return REDACTED;
  if (/^Bearer\s+\S+/i.test(value)) return REDACTED;
  return value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]`
    : value;
}

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_RE.test(key) ? REDACTED : redactValue(val);
    }
    return out;
  }
  return value;
}

export interface AuditEvent {
  tool: string;
  intentClass: IntentClass;
  decision: "allow" | "deny";
  status: "ok" | "error";
  durationMs: number;
  args: Record<string, unknown>;
  errorCode?: string;
  /** When set, skip post-hoc intent creation (pre-exec intent already recorded). */
  skipIntentCreate?: boolean;
  /** Optional audit gate label (e.g. backup trust). */
  gate?: string;
  intentId?: string;
}

export function buildAuditLine(event: AuditEvent): string {
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    event: "flux_mcp_tool_call",
    tool: event.tool,
    intentClass: event.intentClass,
    decision: event.decision,
    status: event.status,
    durationMs: event.durationMs,
    args: redactValue(event.args),
  };
  if (event.errorCode !== undefined) {
    payload.errorCode = event.errorCode;
  }
  return JSON.stringify(payload);
}

/** Emit one redacted audit line. `write` is injectable for tests. */
export function emitAudit(
  event: AuditEvent,
  write: (line: string) => void = (line) => {
    process.stderr.write(`${line}\n`);
  },
): void {
  write(buildAuditLine(event));
}

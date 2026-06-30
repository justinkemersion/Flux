/**
 * Detect obvious secrets in MCP audit/intent payloads before persistence.
 * Defense-in-depth alongside field-level redaction in `@flux/mcp`.
 */

import {
  FLX_MCP_KEY_FULL_RE,
  isSafeMcpKeyPreview,
  stringContainsMcpTokenMaterial,
} from "./mcp-secret-patterns";

const SENSITIVE_KEY_RE =
  /(token|secret|password|passwd|pwd|jwt|authorization|auth|api[_-]?key|anon[_-]?key|service[_-]?role|credential|bearer|\bkey\b)/i;

/** JWT-shaped bearer material (header.payload.signature). */
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/;

/** Postgres / generic URL with userinfo credentials. */
const CONNECTION_STRING_RE =
  /\b(?:postgres(?:ql)?|mysql|mongodb):\/\/[^\s:@/]+:[^\s@/]+@/i;

/** Flux live CLI key prefix. */
const FLX_LIVE_KEY_RE = /\bflx_live_[a-f0-9]{32}_[a-f0-9]{4}\b/i;

export { FLX_MCP_KEY_FULL_RE, isSafeMcpKeyPreview, stringContainsMcpTokenMaterial };

export function containsObviousSecret(value: unknown, keyPath = ""): boolean {
  if (typeof value === "string") {
    if (keyPath === "keyPreview" && isSafeMcpKeyPreview(value)) return false;
    if (keyPath.endsWith(".keyPreview") && isSafeMcpKeyPreview(value)) return false;
    if (SENSITIVE_KEY_RE.test(keyPath) && !isSafeMcpKeyPreview(value)) return true;
    if (JWT_RE.test(value)) return true;
    if (CONNECTION_STRING_RE.test(value)) return true;
    if (FLX_LIVE_KEY_RE.test(value)) return true;
    if (stringContainsMcpTokenMaterial(value)) return true;
    if (/^Bearer\s+\S+/i.test(value)) return true;
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item, i) => containsObviousSecret(item, `${keyPath}[${String(i)}]`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(([key, val]) =>
      containsObviousSecret(val, keyPath ? `${keyPath}.${key}` : key),
    );
  }
  return false;
}

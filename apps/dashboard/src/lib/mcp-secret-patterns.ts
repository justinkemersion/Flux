/** Full scoped MCP token: `flx_mcp_<12 hex>_<20 hex>_<4 hex>`. */
export const FLX_MCP_KEY_FULL_RE =
  /\bflx_mcp_[a-f0-9]{12}_[a-f0-9]{20}_[a-f0-9]{4}\b/i;

/** Partial / truncated MCP token material (not safe keyPreview). */
export const FLX_MCP_KEY_PARTIAL_RE =
  /\bflx_mcp_(?:[a-f0-9]{12}_[a-f0-9]{1,}|[a-f0-9]{4}_[a-f0-9]{4,}|[a-f0-9]{8,})\b/i;

/** Safe display fragment from dashboard — never treat as a secret. */
export const FLX_MCP_KEY_PREVIEW_RE = /^flx_mcp_[a-f0-9]{4}…[a-f0-9]{4}$/i;

export function isSafeMcpKeyPreview(value: string): boolean {
  return FLX_MCP_KEY_PREVIEW_RE.test(value.trim());
}

export function stringContainsMcpTokenMaterial(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (isSafeMcpKeyPreview(trimmed)) return false;
  if (FLX_MCP_KEY_FULL_RE.test(trimmed)) return true;
  if (FLX_MCP_KEY_PARTIAL_RE.test(trimmed)) return true;
  if (/^Bearer\s+flx_mcp_/i.test(trimmed)) return true;
  return false;
}

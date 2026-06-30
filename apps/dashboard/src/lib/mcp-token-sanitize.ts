/**
 * Sanitize MCP token rows for dashboard list APIs.
 * Never expose keyHash or plaintext token material.
 */

import { FLUX_MCP_TOKEN_REGEX } from "@/src/lib/mcp-token-auth";

const FLX_MCP_KEY_RE = /\bflx_mcp_[a-f0-9]{12}_[a-f0-9]{20}_[a-f0-9]{4}\b/i;

export interface SafeMcpTokenRecord {
  id: string;
  keyId: string;
  keyPreview: string;
  name: string | null;
  projectIds: string[];
  capabilities: string[];
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  metadata: Record<string, unknown>;
}

type McpTokenRow = {
  id: string;
  keyId: string;
  keyPreview: string;
  projectIds: unknown;
  capabilities: unknown;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  metadata: Record<string, unknown> | null;
};

export function sanitizeMcpTokenMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key === "token" || key === "keyHash" || key === "key_hash") continue;
    if (typeof value === "string" && (FLX_MCP_KEY_RE.test(value) || FLUX_MCP_TOKEN_REGEX.test(value))) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function extractMcpTokenName(metadata: Record<string, unknown> | null | undefined): string | null {
  const sanitized = sanitizeMcpTokenMetadata(metadata);
  const name = sanitized.name;
  return typeof name === "string" && name.trim().length > 0 ? name.trim().slice(0, 128) : null;
}

export function sanitizeMcpTokenRow(row: McpTokenRow): SafeMcpTokenRecord {
  const metadata = sanitizeMcpTokenMetadata(row.metadata);
  const projectIds = Array.isArray(row.projectIds)
    ? row.projectIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const capabilities = Array.isArray(row.capabilities)
    ? row.capabilities.filter((c): c is string => typeof c === "string" && c.length > 0)
    : [];

  return {
    id: row.id,
    keyId: row.keyId,
    keyPreview: row.keyPreview,
    name: extractMcpTokenName(metadata),
    projectIds,
    capabilities,
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    metadata,
  };
}

export function mcpTokenListResponseContainsSecret(payload: unknown): boolean {
  const text = JSON.stringify(payload);
  return FLX_MCP_KEY_RE.test(text);
}

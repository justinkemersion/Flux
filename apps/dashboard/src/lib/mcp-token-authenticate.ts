import { and, eq, isNull, lt, or } from "drizzle-orm";
import { mcpTokens } from "@/src/db/schema";
import type { McpCapability } from "@/src/lib/mcp-capabilities";
import { validateMcpCapabilities } from "@/src/lib/mcp-capabilities";
import type { SystemDb } from "@/src/lib/db";
import {
  hashMcpToken,
  isMcpTokenLike,
  parseMcpToken,
} from "@/src/lib/mcp-token-auth";

const DEFAULT_LAST_USED_THROTTLE_MS = 60 * 60 * 1000;

export type McpTokenAuthResult = {
  keyType: "mcp";
  userId: string;
  /** Row UUID — stored on audit/intent rows as keyId. */
  keyId: string;
  /** Embedded token segment (flux_mcp_tokens.key_id). */
  embeddedKeyId: string;
  keyPreview: string;
  projectIds: string[];
  capabilities: McpCapability[];
  expiresAt: Date;
};

export type McpTokenAuthFailureReason =
  | "invalid_format"
  | "not_found"
  | "expired"
  | "revoked"
  | "invalid_capabilities";

export type McpTokenAuthenticateResult =
  | { ok: true; auth: McpTokenAuthResult }
  | { ok: false; reason: McpTokenAuthFailureReason };

/**
 * Validates `flx_mcp_…` Bearer token against `flux_mcp_tokens`.
 * Never logs the plaintext token.
 */
export async function authenticateMcpToken(
  db: SystemDb,
  bearerSecret: string | null | undefined,
  options?: { throttleLastUsedMs?: number; now?: Date },
): Promise<McpTokenAuthenticateResult> {
  if (!bearerSecret || typeof bearerSecret !== "string") {
    return { ok: false, reason: "invalid_format" };
  }
  const token = bearerSecret.trim();
  if (!isMcpTokenLike(token) || parseMcpToken(token) === null) {
    return { ok: false, reason: "invalid_format" };
  }

  const keyHash = hashMcpToken(token);
  const rows = await db
    .select({
      id: mcpTokens.id,
      userId: mcpTokens.userId,
      keyId: mcpTokens.keyId,
      keyPreview: mcpTokens.keyPreview,
      projectIds: mcpTokens.projectIds,
      capabilities: mcpTokens.capabilities,
      expiresAt: mcpTokens.expiresAt,
      revokedAt: mcpTokens.revokedAt,
    })
    .from(mcpTokens)
    .where(eq(mcpTokens.keyHash, keyHash))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return { ok: false, reason: "not_found" };
  }
  if (row.revokedAt) {
    return { ok: false, reason: "revoked" };
  }

  const now = options?.now ?? new Date();
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  const caps = validateMcpCapabilities(row.capabilities);
  if (!caps.ok) {
    return { ok: false, reason: "invalid_capabilities" };
  }

  const projectIds = Array.isArray(row.projectIds)
    ? row.projectIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  if (projectIds.length === 0) {
    return { ok: false, reason: "invalid_capabilities" };
  }

  const throttleMs = options?.throttleLastUsedMs ?? DEFAULT_LAST_USED_THROTTLE_MS;
  const cutoff = new Date(now.getTime() - throttleMs);
  try {
    await db
      .update(mcpTokens)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(mcpTokens.id, row.id),
          or(isNull(mcpTokens.lastUsedAt), lt(mcpTokens.lastUsedAt, cutoff)),
        ),
      );
  } catch {
    // Non-fatal — auth still succeeds if last-used tracking fails.
  }

  return {
    ok: true,
    auth: {
      keyType: "mcp",
      userId: row.userId,
      keyId: row.id,
      embeddedKeyId: row.keyId,
      keyPreview: row.keyPreview,
      projectIds,
      capabilities: caps.capabilities,
      expiresAt: row.expiresAt,
    },
  };
}

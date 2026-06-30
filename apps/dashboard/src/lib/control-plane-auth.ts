import { authenticateCliApiKey, FLUX_CLI_KEY_PREFIX } from "@/src/lib/cli-api-auth";
import type { SystemDb } from "@/src/lib/db";
import {
  authenticateMcpToken,
  type McpTokenAuthResult,
} from "@/src/lib/mcp-token-authenticate";
import { isMcpTokenLike } from "@/src/lib/mcp-token-auth";

export type { McpTokenAuthResult } from "@/src/lib/mcp-token-authenticate";

export type CliControlPlaneAuth = {
  keyType: "cli";
  userId: string;
  keyId: string;
};

export type ControlPlaneAuth = CliControlPlaneAuth | McpTokenAuthResult;

export function isMcpControlPlaneAuth(
  auth: ControlPlaneAuth,
): auth is McpTokenAuthResult {
  return auth.keyType === "mcp";
}

export function isCliControlPlaneAuth(
  auth: ControlPlaneAuth,
): auth is CliControlPlaneAuth {
  return auth.keyType === "cli";
}

/** Narrow auth for audit/intent persistence ({ userId, keyId }). */
export function controlPlaneAuthIdentity(auth: ControlPlaneAuth): {
  userId: string;
  keyId: string;
} {
  return { userId: auth.userId, keyId: auth.keyId };
}

/** Safe auth metadata merged server-side into audit/intent rows for MCP tokens. */
export function controlPlaneAuthPersistenceMetadata(
  auth: ControlPlaneAuth,
): Record<string, unknown> {
  if (isMcpControlPlaneAuth(auth)) {
    return {
      authFamily: "mcp",
      keyType: "mcp",
      keyPreview: auth.keyPreview,
      embeddedKeyId: auth.embeddedKeyId,
    };
  }
  return {
    authFamily: "cli",
    keyType: "cli",
  };
}

export function mergeControlPlaneAuthMetadata(
  auth: ControlPlaneAuth,
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const authMeta = controlPlaneAuthPersistenceMetadata(auth);
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...metadata }
      : {};
  delete base.token;
  delete base.keyHash;
  delete base.key_hash;
  const merged = { ...base, ...authMeta };
  return Object.keys(merged).length > 0 ? merged : null;
}

/**
 * Dispatches Bearer auth to `flx_live_` CLI keys or `flx_mcp_` MCP tokens.
 * Returns null when the token is missing, unknown, expired, or revoked.
 */
export async function authenticateControlPlaneBearer(
  db: SystemDb,
  bearerSecret: string | null | undefined,
  options?: { throttleLastUsedMs?: number; now?: Date },
): Promise<ControlPlaneAuth | null> {
  if (!bearerSecret || typeof bearerSecret !== "string") {
    return null;
  }
  const token = bearerSecret.trim();
  if (!token) return null;

  if (isMcpTokenLike(token)) {
    const mcp = await authenticateMcpToken(db, token, options);
    return mcp.ok ? mcp.auth : null;
  }

  if (token.startsWith(`${FLUX_CLI_KEY_PREFIX}_`)) {
    const cli = await authenticateCliApiKey(db, token, options);
    return cli ? { keyType: "cli", userId: cli.userId, keyId: cli.keyId } : null;
  }

  return null;
}

/**
 * Cached MCP token profile from /api/cli/v1/auth/verify (Slice F).
 */

import {
  isMcpVerifyResult,
  resolveMcpServerToken,
  type ApiClient,
} from "@flux/cli/api-client";
import type { FluxToolClient } from "./tools";

export type McpTokenProfile = {
  tokenFamily: "mcp";
  capabilities: readonly string[];
  keyPreview: string;
  embeddedKeyId: string;
  expiresAt: string;
};

let cachedProfile: McpTokenProfile | null | undefined;
let profilePromise: Promise<McpTokenProfile | null> | null = null;

export function resetMcpTokenProfileCache(): void {
  cachedProfile = undefined;
  profilePromise = null;
}

function clientSupportsVerify(
  client: FluxToolClient,
): client is FluxToolClient & Pick<ApiClient, "verifyToken"> {
  return typeof (client as ApiClient).verifyToken === "function";
}

export async function getMcpTokenProfile(
  client: FluxToolClient,
): Promise<McpTokenProfile | null> {
  const resolved = resolveMcpServerToken();
  if (resolved.source !== "FLUX_MCP_TOKEN" || !resolved.token) {
    return null;
  }
  if (cachedProfile !== undefined) {
    return cachedProfile;
  }
  if (!profilePromise) {
    profilePromise = (async () => {
      if (!clientSupportsVerify(client)) {
        return null;
      }
      try {
        const verify = await client.verifyToken(resolved.token!);
        if (!isMcpVerifyResult(verify)) {
          return null;
        }
        return {
          tokenFamily: "mcp",
          capabilities: verify.capabilities,
          keyPreview: verify.keyPreview,
          embeddedKeyId: verify.embeddedKeyId,
          expiresAt: verify.expiresAt,
        };
      } catch {
        return null;
      }
    })();
  }
  cachedProfile = await profilePromise;
  return cachedProfile;
}

export function tokenHasCapability(
  profile: McpTokenProfile,
  capability: string,
): boolean {
  return profile.capabilities.includes(capability);
}

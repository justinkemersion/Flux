/**
 * MCP server token resolution (Phase 5 Slice E).
 * CLI `resolveFluxApiToken()` is unchanged — this is MCP-only.
 */

import { loadConfig } from "../config";

export const FLUX_MCP_KEY_PREFIX = "flx_mcp" as const;
export const FLUX_CLI_KEY_PREFIX = "flx_live" as const;

/** `flx_mcp_<12 hex keyId>_<20 hex secret>_<4 hex checksum>` */
const FLUX_MCP_TOKEN_REGEX =
  /^flx_mcp_([a-f0-9]{12})_([a-f0-9]{20})_([a-f0-9]{4})$/i;

export type TokenFamily = "mcp" | "cli" | "unknown";

export type McpTokenSource =
  | "FLUX_MCP_TOKEN"
  | "FLUX_API_TOKEN"
  | "config_file"
  | "none";

export type ResolvedMcpServerToken = {
  token?: string;
  source: McpTokenSource;
  family: TokenFamily;
};

export function isMcpTokenLike(token: string): boolean {
  return token.trim().startsWith(`${FLUX_MCP_KEY_PREFIX}_`);
}

export function isCliTokenLike(token: string): boolean {
  return token.trim().startsWith(`${FLUX_CLI_KEY_PREFIX}_`);
}

export function isValidMcpTokenFormat(token: string): boolean {
  return FLUX_MCP_TOKEN_REGEX.test(token.trim());
}

export function detectTokenFamily(token: string): TokenFamily {
  const trimmed = token.trim();
  if (isMcpTokenLike(trimmed)) return "mcp";
  if (isCliTokenLike(trimmed)) return "cli";
  return "unknown";
}

/**
 * MCP auth order: `FLUX_MCP_TOKEN` → `FLUX_API_TOKEN` → `~/.flux/config.json`.
 */
export function resolveMcpServerToken(): ResolvedMcpServerToken {
  const fromMcp = process.env.FLUX_MCP_TOKEN?.trim();
  if (fromMcp) {
    return {
      token: fromMcp,
      source: "FLUX_MCP_TOKEN",
      family: detectTokenFamily(fromMcp),
    };
  }
  const fromApi = process.env.FLUX_API_TOKEN?.trim();
  if (fromApi) {
    return {
      token: fromApi,
      source: "FLUX_API_TOKEN",
      family: detectTokenFamily(fromApi),
    };
  }
  const fromConfig = loadConfig()?.token;
  if (fromConfig) {
    return {
      token: fromConfig,
      source: "config_file",
      family: detectTokenFamily(fromConfig),
    };
  }
  return { source: "none", family: "unknown" };
}

export function assertValidMcpEnvToken(resolved: ResolvedMcpServerToken): void {
  if (resolved.source !== "FLUX_MCP_TOKEN") return;
  const token = resolved.token;
  if (!token || !isMcpTokenLike(token)) {
    throw new Error(
      "FLUX_MCP_TOKEN must be a scoped flx_mcp_ token. Create one at /settings/mcp-tokens.",
    );
  }
  if (!isValidMcpTokenFormat(token)) {
    throw new Error(
      "FLUX_MCP_TOKEN has an invalid flx_mcp_ format. Create a new scoped token at /settings/mcp-tokens.",
    );
  }
}

export const LEGACY_MCP_TOKEN_WARNING =
  "[flux-mcp] warning: using a broad CLI token for MCP. Prefer scoped FLUX_MCP_TOKEN (create at /settings/mcp-tokens). FLUX_API_TOKEN remains supported temporarily.\n";

export const NO_MCP_TOKEN_WARNING =
  "[flux-mcp] warning: no API token found. Set FLUX_MCP_TOKEN (recommended) or FLUX_API_TOKEN, or run `flux login`.\n";

export function legacyMcpTokenWarningForSource(
  source: McpTokenSource,
): string | null {
  if (source === "FLUX_API_TOKEN" || source === "config_file") {
    return LEGACY_MCP_TOKEN_WARNING;
  }
  return null;
}

export function warningContainsTokenValue(warning: string, token: string): boolean {
  if (!token) return false;
  return warning.includes(token);
}

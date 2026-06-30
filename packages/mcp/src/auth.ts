/**
 * MCP server auth bootstrap (Phase 5 Slice E).
 */

import {
  assertValidMcpEnvToken,
  legacyMcpTokenWarningForSource,
  NO_MCP_TOKEN_WARNING,
  resolveMcpServerToken,
  type ResolvedMcpServerToken,
} from "@flux/cli/api-client";

export type McpAuthBootstrapResult = ResolvedMcpServerToken;

export function bootstrapMcpAuth(
  writeStderr: (message: string) => void = (message) => {
    process.stderr.write(message);
  },
): McpAuthBootstrapResult {
  const resolved = resolveMcpServerToken();
  assertValidMcpEnvToken(resolved);

  if (resolved.source === "none") {
    writeStderr(NO_MCP_TOKEN_WARNING);
    return resolved;
  }

  const legacyWarning = legacyMcpTokenWarningForSource(resolved.source);
  if (legacyWarning) {
    writeStderr(legacyWarning);
  }

  return resolved;
}

export function isMcpAuthenticated(): boolean {
  return Boolean(resolveMcpServerToken().token);
}

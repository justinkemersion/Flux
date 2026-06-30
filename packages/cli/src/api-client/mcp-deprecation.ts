/**
 * Phase 5 Slice G — legacy `FLUX_API_TOKEN` / `flx_live_` status for MCP (not the Flux CLI).
 */

/** Central status: broad CLI keys still work for MCP with stderr warning. */
export const MCP_LEGACY_CLI_TOKEN_FOR_MCP_STATUS = "supported_with_warning" as const;

export type McpLegacyCliTokenForMcpStatus =
  typeof MCP_LEGACY_CLI_TOKEN_FOR_MCP_STATUS;

/**
 * Formal deprecation countdown prerequisites (Slice G marks docs/examples/UI shipped).
 * Clock starts only after all are true **and** at least one release cycle has passed.
 * No hard removal date until announced.
 */
export const MCP_LEGACY_CLI_TOKEN_DEPRECATION_PREREQUISITES = {
  hostedTokenUiDeployed: true,
  docsPublished: true,
  cursorExamplesPublished: true,
  oneReleaseCycleElapsed: false,
} as const;

export const MCP_LEGACY_CLI_TOKEN_WARNING_PREFIX = "[flux-mcp] warning:" as const;

/** Stderr warning when MCP falls back to `FLUX_API_TOKEN` or `~/.flux/config.json`. */
export function buildMcpLegacyCliTokenWarning(): string {
  return (
    `${MCP_LEGACY_CLI_TOKEN_WARNING_PREFIX} FLUX_API_TOKEN (broad flx_live_ CLI key) remains supported temporarily for MCP. ` +
    `Scoped FLUX_MCP_TOKEN is the recommended default — create one at /settings/mcp-tokens. ` +
    `No hard removal date is set. A formal deprecation countdown begins only after hosted token UI, published docs, ` +
    `Cursor examples, and at least one release cycle have all shipped; existing MCP configs continue to work until then.\n`
  );
}

/** Test helper: warnings must not imply immediate removal. */
export function legacyMcpWarningImpliesImmediateRemoval(warning: string): boolean {
  const lower = warning.toLowerCase();
  return (
    /\bremoved immediately\b/.test(lower) ||
    /\bno longer supported\b/.test(lower) ||
    /\bwill stop working\b/.test(lower) ||
    /\beffective immediately\b/.test(lower)
  );
}

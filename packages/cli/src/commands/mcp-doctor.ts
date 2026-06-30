/**
 * MCP connectivity doctor — validates FLUX_MCP_TOKEN and control-plane reachability.
 * Not a substitute for project health (`flux doctor` / MCP tool `flux.doctor`).
 */

import {
  ApiClient,
  isMcpVerifyResult,
  isValidMcpTokenFormat,
  normalizeFluxApiBase,
} from "@flux/cli/api-client";
import {
  FLUX_MCP_CONTRACT_VERSION,
  FLUX_MCP_REGISTERED_TOOL_COUNT,
} from "@flux/core/mcp-contract";
import {
  MCP_MIGRATION_APPLY_DOCTOR_WARNING_LINES,
  mcpTokenCanApplyMigrations,
} from "@flux/core/mcp-capability-presets";

export type McpDoctorOptions = {
  baseUrl?: string;
  token?: string;
};

export type McpDoctorResult = {
  ok: boolean;
  lines: string[];
  exitCode: number;
};

/** Post-verify warnings appended on successful doctor runs. */
export function mcpDoctorPostVerifyWarnings(capabilities: readonly string[]): string[] {
  if (!mcpTokenCanApplyMigrations(capabilities)) {
    return [];
  }
  return ["", ...MCP_MIGRATION_APPLY_DOCTOR_WARNING_LINES];
}

export async function runMcpDoctorAsync(options: McpDoctorOptions = {}): Promise<McpDoctorResult> {
  const lines: string[] = [];
  const token = options.token?.trim() ?? process.env.FLUX_MCP_TOKEN?.trim();

  if (!token) {
    lines.push("FAIL: FLUX_MCP_TOKEN is not set.");
    lines.push("Create a scoped token at /settings/mcp-tokens and export FLUX_MCP_TOKEN.");
    return { ok: false, lines, exitCode: 1 };
  }

  if (!token.startsWith("flx_mcp_")) {
    lines.push("FAIL: flux mcp doctor requires a scoped flx_mcp_ token in FLUX_MCP_TOKEN.");
    lines.push("CLI flx_live_ keys are not accepted for this command.");
    return { ok: false, lines, exitCode: 1 };
  }

  if (!isValidMcpTokenFormat(token)) {
    lines.push("FAIL: FLUX_MCP_TOKEN has invalid flx_mcp_ format.");
    return { ok: false, lines, exitCode: 1 };
  }

  lines.push("OK: FLUX_MCP_TOKEN format valid.");

  let baseUrl: string;
  try {
    const rawBase =
      options.baseUrl?.trim() ||
      process.env.FLUX_API_BASE?.trim() ||
      "https://flux.vsl-base.com/api";
    baseUrl = normalizeFluxApiBase(rawBase);
  } catch (err) {
    lines.push(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, lines, exitCode: 1 };
  }

  lines.push(`OK: API base ${baseUrl}`);

  const client = new ApiClient(baseUrl, {
    resolveToken: () => token,
  });

  try {
    const verify = await client.verifyToken(token);
    if (!isMcpVerifyResult(verify)) {
      lines.push("FAIL: Token verified but response is not an MCP profile (got CLI profile).");
      return { ok: false, lines, exitCode: 1 };
    }

    lines.push(`OK: GET /api/cli/v1/auth/verify succeeded (keyPreview: ${verify.keyPreview})`);
    lines.push(`    capabilities: ${verify.capabilities.join(", ") || "(none)"}`);
    lines.push(`    project scope: ${verify.projectIds.length} project(s)`);
    lines.push(`    expires: ${verify.expiresAt}`);
    lines.push(
      `OK: MCP contract v${FLUX_MCP_CONTRACT_VERSION} (${FLUX_MCP_REGISTERED_TOOL_COUNT} registered tools)`,
    );

    if (process.env.FLUX_API_TOKEN?.trim()) {
      lines.push("WARN: FLUX_API_TOKEN is set; MCP server prefers FLUX_MCP_TOKEN.");
    }

    lines.push(...mcpDoctorPostVerifyWarnings(verify.capabilities));

    return { ok: true, lines, exitCode: 0 };
  } catch (err) {
    lines.push(`FAIL: auth/verify — ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, lines, exitCode: 1 };
  }
}

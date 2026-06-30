import {
  MCP_TOKEN_EXPIRY_DAYS,
  defaultMcpTokenExpiryDays,
  isMutationCapableMcpToken,
  maxMcpTokenExpiryDays,
} from "@/src/lib/mcp-capabilities";
import {
  MCP_CAPABILITY_PRESET_DEFINITIONS,
  mcpTokenCanApplyMigrations,
  resolveMcpCapabilityPresetId,
  type McpCapabilityPresetDefinition,
  type McpCapabilityPresetId,
} from "@flux/core/mcp-capability-presets";
import type { SafeMcpTokenRecord } from "@/src/lib/mcp-token-sanitize";
import { mcpTokenListResponseContainsSecret } from "@/src/lib/mcp-token-sanitize";
import type {
  McpTokenCreateFormState,
  McpTokenListRow,
  McpTokenProjectOption,
  McpTokenStatus,
} from "./mcp-tokens-types";

export const MCP_TOKENS_PAGE_PATH = "/settings/mcp-tokens";

export const MCP_TOKENS_PAGE_INTRO =
  "Scoped tokens for the Flux MCP server — limited to selected projects, capabilities, and expiry. Set the plaintext token as FLUX_MCP_TOKEN in your MCP client (for example Cursor). Plaintext is shown once at creation; only a hash is stored server-side.";

export const MCP_TOKENS_PAGE_LEGACY_NOTE =
  "Do not use broad API keys (flx_live_) for MCP unless necessary. FLUX_API_TOKEN remains a temporary legacy fallback for MCP with a stderr warning; scoped FLUX_MCP_TOKEN is the recommended default.";

export const MCP_TOKENS_PAGE_CLI_NOTE =
  "CLI automation continues to use API Keys (flx_live_). MCP tokens cannot replace the Flux CLI.";

export const MCP_TOKEN_PLAINTEXT_ONCE_BANNER =
  "This token is shown once. Store it now.";

export const MCP_TOKEN_FLUX_MCP_ENV_HINT =
  "Export as FLUX_MCP_TOKEN in your MCP client config (for example Cursor mcpServers.flux.env). This string is not stored in the dashboard.";

export const MCP_TOKEN_API = {
  list: "/api/agent/mcp-tokens",
  create: "/api/agent/mcp-tokens",
  revoke: (id: string) => `/api/agent/mcp-tokens/${encodeURIComponent(id)}`,
} as const;

export const MUTATION_CAPABILITY_WARNING =
  "Selected capabilities include migration apply or backup ensure — these tokens have shorter default expiry and can mutate project state.";

export { MCP_CAPABILITY_PRESET_DEFINITIONS };
export type { McpCapabilityPresetDefinition, McpCapabilityPresetId };

export const MCP_MIGRATION_APPLY_TOKEN_WARNING =
  "This token can apply migrations to project databases. Do not use it as your default Cursor MCP token.";

export function showsMigrationApplyWarning(capabilities: readonly string[]): boolean {
  return mcpTokenCanApplyMigrations(capabilities);
}

export function activeMcpCapabilityPresetId(
  capabilities: readonly string[],
): McpCapabilityPresetId | null {
  return resolveMcpCapabilityPresetId(capabilities);
}

export function mcpTokensSignInRedirectUrl(): string {
  return `/api/auth/signin?callbackUrl=${encodeURIComponent(MCP_TOKENS_PAGE_PATH)}`;
}

export function resolveMcpTokenStatus(
  token: Pick<SafeMcpTokenRecord, "revokedAt" | "expiresAt">,
  now: Date = new Date(),
): McpTokenStatus {
  if (token.revokedAt) return "revoked";
  if (new Date(token.expiresAt).getTime() <= now.getTime()) return "expired";
  return "active";
}

export function formatMcpTokenTimestamp(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toISOString().replace("T", " ").slice(0, 19) + "Z";
  } catch {
    return iso;
  }
}

export function formatProjectLabel(
  projectIds: string[],
  projectsById: Record<string, McpTokenProjectOption>,
): string {
  if (projectIds.length === 0) return "No projects";
  const labels = projectIds.map((id) => {
    const project = projectsById[id];
    return project ? `${project.name} (${project.slug})` : id.slice(0, 8);
  });
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.length} projects`;
}

export function projectsByIdFromOptions(
  projects: McpTokenProjectOption[],
): Record<string, McpTokenProjectOption> {
  const out: Record<string, McpTokenProjectOption> = {};
  for (const project of projects) {
    out[project.id] = project;
  }
  return out;
}

export function toMcpTokenListRows(
  tokens: SafeMcpTokenRecord[],
  projectsById: Record<string, McpTokenProjectOption>,
  now: Date = new Date(),
): McpTokenListRow[] {
  return tokens.map((token) => ({
    ...token,
    status: resolveMcpTokenStatus(token, now),
    projectLabel: formatProjectLabel(token.projectIds, projectsById),
  }));
}

export function validateMcpTokenCreateForm(
  form: Pick<McpTokenCreateFormState, "projectIds" | "capabilities">,
): string | null {
  if (!form.projectIds.length) {
    return "Select at least one project.";
  }
  if (!form.capabilities.length) {
    return "Select at least one capability.";
  }
  return null;
}

export function showsMutationCapableWarning(capabilities: readonly string[]): boolean {
  return isMutationCapableMcpToken(capabilities);
}

export type McpTokenExpiryOption = {
  days: number;
  label: string;
};

export function mcpTokenExpiryOptions(
  capabilities: readonly string[],
): McpTokenExpiryOption[] {
  const defaultDays = defaultMcpTokenExpiryDays(capabilities);
  const maxDays = maxMcpTokenExpiryDays(capabilities);
  const tier = isMutationCapableMcpToken(capabilities) ? "mutation" : "read-only";
  const presets = new Set<number>([defaultDays, 1, 7, 14, 30, 60, 90].filter((d) => d <= maxDays));
  presets.add(defaultDays);
  const sorted = Array.from(presets).sort((a, b) => a - b);
  return sorted.map((days) => ({
    days,
    label:
      days === defaultDays
        ? `Default (${days}d, ${tier})`
        : `${days} day${days === 1 ? "" : "s"}`,
  }));
}

export function expiryIsoFromDays(days: number, now: Date = new Date()): string {
  const out = new Date(now.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out.toISOString();
}

export function defaultExpiryDaysForCapabilities(capabilities: readonly string[]): number {
  return defaultMcpTokenExpiryDays(capabilities);
}

export function applyCreateTokenToList(
  tokens: SafeMcpTokenRecord[],
  tokenRecord: SafeMcpTokenRecord,
): SafeMcpTokenRecord[] {
  return [tokenRecord, ...tokens.filter((t) => t.id !== tokenRecord.id)];
}

export function applyRevokeToTokenList(
  tokens: SafeMcpTokenRecord[],
  tokenId: string,
  revokedAt: string,
): SafeMcpTokenRecord[] {
  return tokens.map((token) =>
    token.id === tokenId ? { ...token, revokedAt } : token,
  );
}

/** List/detail render payloads must never include plaintext tokens or key hashes. */
export function mcpTokenDisplayContainsSecret(payload: unknown): boolean {
  const text = JSON.stringify(payload);
  if (mcpTokenListResponseContainsSecret(payload)) return true;
  if (/"keyHash"|"key_hash"/i.test(text)) return true;
  return false;
}

export function mcpTokenListDisplayPayload(rows: McpTokenListRow[]): unknown {
  return { tokens: rows };
}

export function parseMcpTokenCreateResponse(json: unknown): {
  token: string;
  tokenRecord: SafeMcpTokenRecord;
} | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const record = json as Record<string, unknown>;
  if (typeof record.token !== "string" || !record.tokenRecord) return null;
  const tokenRecord = record.tokenRecord;
  if (!tokenRecord || typeof tokenRecord !== "object" || Array.isArray(tokenRecord)) {
    return null;
  }
  return { token: record.token, tokenRecord: tokenRecord as SafeMcpTokenRecord };
}

export function readOnlyExpiryTierSummary(): string {
  return `${MCP_TOKEN_EXPIRY_DAYS.readOnly.default}d default, ${MCP_TOKEN_EXPIRY_DAYS.readOnly.max}d max`;
}

export function mutationExpiryTierSummary(): string {
  return `${MCP_TOKEN_EXPIRY_DAYS.mutationCapable.default}d default, ${MCP_TOKEN_EXPIRY_DAYS.mutationCapable.max}d max`;
}

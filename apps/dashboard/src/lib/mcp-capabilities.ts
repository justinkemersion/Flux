/**
 * Scoped MCP token capabilities (Phase 5).
 * Canonical enum lives in @flux/core/mcp-capabilities.
 */

export {
  MCP_CAPABILITIES,
  isKnownMcpCapability,
  type McpCapability,
} from "@flux/core/mcp-capabilities";

import { MCP_CAPABILITIES, type McpCapability } from "@flux/core/mcp-capabilities";

const MCP_CAPABILITY_SET = new Set<string>(MCP_CAPABILITIES);

/** Capabilities that imply backup/migration side effects — shorter default expiry. */
export const MUTATION_MCP_CAPABILITIES = [
  "migration:apply",
  "backup:ensure_verified",
] as const satisfies readonly McpCapability[];

const MUTATION_CAPABILITY_SET = new Set<string>(MUTATION_MCP_CAPABILITIES);

export const MCP_TOKEN_EXPIRY_DAYS = {
  readOnly: { default: 30, max: 90 },
  mutationCapable: { default: 7, max: 30 },
} as const;

export function validateMcpCapabilities(
  capabilities: readonly string[],
): { ok: true; capabilities: McpCapability[] } | { ok: false; error: string } {
  if (capabilities.length === 0) {
    return { ok: false, error: "At least one capability is required." };
  }
  const normalized: McpCapability[] = [];
  const seen = new Set<string>();
  for (const raw of capabilities) {
    const cap = raw.trim();
    if (!cap) {
      return { ok: false, error: "Capabilities must be non-empty strings." };
    }
    if (!MCP_CAPABILITY_SET.has(cap)) {
      return { ok: false, error: `Unknown capability: ${cap}` };
    }
    if (seen.has(cap)) continue;
    seen.add(cap);
    normalized.push(cap as McpCapability);
  }
  return { ok: true, capabilities: normalized };
}

/** True when the token includes migration apply or backup ensure (temporary-by-default). */
export function isMutationCapableMcpToken(capabilities: readonly string[]): boolean {
  return capabilities.some((c) => MUTATION_CAPABILITY_SET.has(c));
}

export function defaultMcpTokenExpiryDays(capabilities: readonly string[]): number {
  return isMutationCapableMcpToken(capabilities)
    ? MCP_TOKEN_EXPIRY_DAYS.mutationCapable.default
    : MCP_TOKEN_EXPIRY_DAYS.readOnly.default;
}

export function maxMcpTokenExpiryDays(capabilities: readonly string[]): number {
  return isMutationCapableMcpToken(capabilities)
    ? MCP_TOKEN_EXPIRY_DAYS.mutationCapable.max
    : MCP_TOKEN_EXPIRY_DAYS.readOnly.max;
}

export function defaultMcpTokenExpiresAt(
  capabilities: readonly string[],
  now: Date = new Date(),
): Date {
  const days = defaultMcpTokenExpiryDays(capabilities);
  return addUtcDays(now, days);
}

export function validateMcpTokenExpiry(
  expiresAt: Date,
  capabilities: readonly string[],
  now: Date = new Date(),
): { ok: true } | { ok: false; error: string } {
  if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
    return { ok: false, error: "expiresAt must be a valid date." };
  }
  if (expiresAt.getTime() <= now.getTime()) {
    return { ok: false, error: "expiresAt must be in the future." };
  }
  const maxDays = maxMcpTokenExpiryDays(capabilities);
  const maxAt = addUtcDays(now, maxDays);
  if (expiresAt.getTime() > maxAt.getTime()) {
    const tier = isMutationCapableMcpToken(capabilities) ? "mutation-capable" : "read-only";
    return {
      ok: false,
      error: `expiresAt exceeds the ${maxDays}-day maximum for ${tier} MCP tokens.`,
    };
  }
  return { ok: true };
}

function addUtcDays(from: Date, days: number): Date {
  const out = new Date(from.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/**
 * MCP resource capability checks (defense-in-depth, mirrors tool guard).
 */

import { resolveMcpServerToken } from "@flux/cli/api-client";
import type { McpCapability } from "@flux/cli/api-client";
import type { FluxToolClient } from "./tools";
import { getMcpTokenProfile, tokenHasCapability } from "./mcp-token-profile";

export async function assertMcpResourceCapabilityAllowed(
  required: McpCapability,
  client: FluxToolClient,
  label: string,
): Promise<string | null> {
  const resolved = resolveMcpServerToken();
  if (resolved.source !== "FLUX_MCP_TOKEN") {
    return null;
  }

  const profile = await getMcpTokenProfile(client);
  if (!profile) {
    return null;
  }

  if (!tokenHasCapability(profile, required)) {
    return `Resource ${label} requires capability ${required}.`;
  }

  return null;
}

const PROJECT_HASH_RE = /^[a-f0-9]{7}$/u;

export type ParsedProjectResource =
  | { kind: "projects" }
  | { kind: "project"; hash: string }
  | { kind: "project_sub"; hash: string; sub: "schema" | "backups" | "activity" | "doctor" }
  | { kind: "doc"; slug: string }
  | { kind: "unknown" };

export function parseFluxResourceUri(uri: string): ParsedProjectResource {
  if (uri === "flux://projects") {
    return { kind: "projects" };
  }

  const docMatch = /^flux:\/\/docs\/(.+)$/u.exec(uri);
  if (docMatch?.[1]) {
    return { kind: "doc", slug: docMatch[1] };
  }

  const projectMatch = /^flux:\/\/projects\/([a-f0-9]{7})(?:\/([a-z]+))?$/iu.exec(uri);
  if (!projectMatch) {
    return { kind: "unknown" };
  }

  const hash = projectMatch[1]!.toLowerCase();
  if (!PROJECT_HASH_RE.test(hash)) {
    return { kind: "unknown" };
  }

  const sub = projectMatch[2]?.toLowerCase();
  if (!sub) {
    return { kind: "project", hash };
  }

  if (sub === "schema" || sub === "backups" || sub === "activity" || sub === "doctor") {
    return { kind: "project_sub", hash, sub };
  }

  return { kind: "unknown" };
}

export function requiredCapabilityForResource(parsed: ParsedProjectResource): McpCapability | null {
  switch (parsed.kind) {
    case "projects":
    case "project":
    case "project_sub":
      if (parsed.kind === "project_sub") {
        if (parsed.sub === "schema") return "schema:read";
        if (parsed.sub === "backups") return "backup:read";
        if (parsed.sub === "activity") return "activity:read";
        if (parsed.sub === "doctor") return "project:read";
      }
      return "project:read";
    case "doc":
      return null;
    default:
      return null;
  }
}

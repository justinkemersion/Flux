import type { AgentActivityFilters } from "./agent-activity-types";

export const AGENT_INTENTS_API_PATH = "/api/agent/intents";

const FORBIDDEN_DISPLAY_RE = [
  /"requestSummary"/i,
  /\bCREATE\s+TABLE\b/i,
  /\bworkspaceRoot\b/i,
  /postgres:\/\//i,
  /flx_live_/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\/srv\//i,
  /\/home\//i,
  /primaryArtifact/i,
  /offsiteKey/i,
  /signedUrl/i,
];

export function buildAgentIntentsQuery(
  filters: AgentActivityFilters,
  options: { limit?: number; cursor?: string } = {},
): string {
  const params = new URLSearchParams();
  if (filters.projectHash.trim()) {
    params.set("projectHash", filters.projectHash.trim().toLowerCase());
  }
  if (filters.tool.trim()) params.set("tool", filters.tool.trim());
  if (filters.status.trim()) params.set("status", filters.status.trim());
  if (filters.intentClass.trim()) params.set("intentClass", filters.intentClass.trim());
  if (filters.riskLevel.trim()) params.set("riskLevel", filters.riskLevel.trim());
  params.set("limit", String(options.limit ?? 50));
  if (options.cursor?.trim()) params.set("cursor", options.cursor.trim());
  const qs = params.toString();
  return qs.length > 0 ? `${AGENT_INTENTS_API_PATH}?${qs}` : AGENT_INTENTS_API_PATH;
}

export function parseAgentActivityFilters(
  searchParams: URLSearchParams,
): AgentActivityFilters {
  return {
    projectHash: searchParams.get("projectHash")?.trim() ?? "",
    tool: searchParams.get("tool")?.trim() ?? "",
    status: searchParams.get("status")?.trim() ?? "",
    intentClass: searchParams.get("intentClass")?.trim() ?? "",
    riskLevel: searchParams.get("riskLevel")?.trim() ?? "",
  };
}

export function filtersToSearchParams(filters: AgentActivityFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.projectHash.trim()) params.set("projectHash", filters.projectHash.trim());
  if (filters.tool.trim()) params.set("tool", filters.tool.trim());
  if (filters.status.trim()) params.set("status", filters.status.trim());
  if (filters.intentClass.trim()) params.set("intentClass", filters.intentClass.trim());
  if (filters.riskLevel.trim()) params.set("riskLevel", filters.riskLevel.trim());
  return params;
}

export function formatAgentActivityTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function statusBadgeClass(status: string): string {
  switch (status) {
    case "completed":
      return "bg-emerald-950/50 text-emerald-300 ring-emerald-800/60";
    case "failed":
      return "bg-red-950/40 text-red-300 ring-red-900/50";
    case "denied":
      return "bg-amber-950/40 text-amber-200 ring-amber-900/50";
    case "pending":
      return "bg-zinc-800/80 text-zinc-300 ring-zinc-700/60";
    default:
      return "bg-zinc-800/60 text-zinc-400 ring-zinc-700/50";
  }
}

export function riskBadgeClass(risk: string): string {
  switch (risk) {
    case "destructive":
      return "text-red-300";
    case "sensitive":
      return "text-amber-300";
    case "medium":
      return "text-sky-300";
    default:
      return "text-zinc-400";
  }
}

/** Test helper: true when serialized UI payload contains forbidden material. */
export function containsForbiddenAgentActivityDisplay(value: unknown): boolean {
  const text = JSON.stringify(value);
  return FORBIDDEN_DISPLAY_RE.some((re) => re.test(text));
}

export function safeJsonPreview(value: Record<string, unknown> | null): string {
  if (!value || Object.keys(value).length === 0) return "—";
  return JSON.stringify(value, null, 2);
}

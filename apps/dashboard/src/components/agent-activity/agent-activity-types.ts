import type { McpIntentClass, McpResultStatus } from "@/src/lib/mcp-audit";
import type { McpIntentStatus, McpRiskLevel } from "@/src/lib/mcp-intents";

export interface AgentActivityIntent {
  id: string;
  createdAt: string;
  updatedAt: string;
  projectHash: string | null;
  tool: string;
  intentClass: McpIntentClass;
  status: McpIntentStatus;
  riskLevel: McpRiskLevel;
  policyDecision: string;
  approvalStatus: string | null;
  resultStatus: McpResultStatus | null;
  errorCode: string | null;
  planId: string | null;
  planHash: string | null;
  summary: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
}

export interface AgentIntentsApiResponse {
  intents: AgentActivityIntent[];
  nextCursor?: string;
}

export interface AgentActivityFilters {
  projectHash: string;
  tool: string;
  status: string;
  intentClass: string;
  riskLevel: string;
}

export const EMPTY_AGENT_ACTIVITY_FILTERS: AgentActivityFilters = {
  projectHash: "",
  tool: "",
  status: "",
  intentClass: "",
  riskLevel: "",
};

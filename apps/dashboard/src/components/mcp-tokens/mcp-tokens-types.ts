import type { SafeMcpTokenRecord } from "@/src/lib/mcp-token-sanitize";

export type McpTokenStatus = "active" | "expired" | "revoked";

export type McpTokenProjectOption = {
  id: string;
  name: string;
  slug: string;
};

export type McpTokenListRow = SafeMcpTokenRecord & {
  status: McpTokenStatus;
  projectLabel: string;
};

export type McpTokenCreateFormState = {
  name: string;
  projectIds: string[];
  capabilities: string[];
  expiryDays: number;
};

export type McpTokenCreateResponse = {
  token: string;
  tokenRecord: SafeMcpTokenRecord;
};

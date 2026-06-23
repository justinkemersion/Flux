import type { ApiClientContext } from "./context";
import {
  errorMessageFromJsonBody,
  parseJsonResponseBody,
} from "./json-response";
import { projectAiSummarySchema } from "./schemas";
import type { ProjectAiSummary } from "./schemas";

export async function generateProjectAiSummary(
  ctx: ApiClientContext,
  hash: string,
  kind: "brief" | "activity" | "resume",
): Promise<ProjectAiSummary> {
  const token = ctx.tokenOrThrow();
  const url = `${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(hash)}/ai/summary`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ kind }),
  });
  if (res.status === 401) {
    throw new Error("Invalid or expired API token. Run `flux login`.");
  }
  const text = await res.text();
  const raw = parseJsonResponseBody(
    text,
    `CLI project AI summary: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
  );
  if (!res.ok) {
    throw new Error(errorMessageFromJsonBody(raw, res.status));
  }
  const body = raw as { summary?: unknown };
  const parsed = projectAiSummarySchema.safeParse(body.summary);
  if (!parsed.success) {
    throw new Error("CLI project AI summary: unexpected response shape.");
  }
  return parsed.data;
}

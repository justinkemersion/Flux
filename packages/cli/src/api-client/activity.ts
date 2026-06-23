import type { ProjectActivityEvent } from "@flux/core/project-activity";
import type { ApiClientContext } from "./context";
import { errorMessageFromJsonBody, parseJsonResponseBody } from "./json-response";

export type ProjectActivityResponse = {
  projectSlug: string;
  hash: string;
  events: ProjectActivityEvent[];
};

export async function fetchProjectActivity(
  ctx: ApiClientContext,
  hash: string,
  limit = 50,
): Promise<ProjectActivityResponse> {
  const token = ctx.tokenOrThrow();
  const url = new URL(
    `${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(hash)}/activity`,
  );
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (res.status === 401) {
    throw new Error("Invalid or expired API token. Run `flux login`.");
  }
  const text = await res.text();
  const raw = parseJsonResponseBody(
    text,
    `CLI activity: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
  );
  if (!res.ok) {
    throw new Error(errorMessageFromJsonBody(raw, res.status));
  }
  return raw as ProjectActivityResponse;
}

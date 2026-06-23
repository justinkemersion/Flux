import type { ApiClientContext } from "./context";
import {
  errorMessageFromJsonBody,
  parseJsonResponseBody,
} from "./json-response";
import { projectFluxMdDetailSchema } from "./schemas";
import type { ProjectFluxMdDetail } from "./schemas";

export async function fetchProjectFluxMdDetail(
  ctx: ApiClientContext,
  hash: string,
): Promise<ProjectFluxMdDetail> {
  const token = ctx.tokenOrThrow();
  const url = `${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(hash)}/flux-md`;
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
    `CLI project brief: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
  );
  if (!res.ok) {
    throw new Error(errorMessageFromJsonBody(raw, res.status));
  }
  const body = raw as { fluxMd?: unknown };
  const parsed = projectFluxMdDetailSchema.safeParse(body.fluxMd);
  if (!parsed.success) {
    throw new Error("CLI project brief: unexpected response shape.");
  }
  return parsed.data;
}

export async function syncProjectFluxMd(
  ctx: ApiClientContext,
  hash: string,
  content: string | null,
): Promise<ProjectFluxMdDetail> {
  const token = ctx.tokenOrThrow();
  const url = `${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(hash)}/flux-md`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });
  if (res.status === 401) {
    throw new Error("Invalid or expired API token. Run `flux login`.");
  }
  const text = await res.text();
  const raw = parseJsonResponseBody(
    text,
    `CLI project brief: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
  );
  if (!res.ok) {
    throw new Error(errorMessageFromJsonBody(raw, res.status));
  }
  const body = raw as { fluxMd?: unknown };
  const parsed = projectFluxMdDetailSchema.safeParse(body.fluxMd);
  if (!parsed.success) {
    throw new Error("CLI project brief: unexpected response shape.");
  }
  return parsed.data;
}

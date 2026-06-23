import type { ApiClientContext } from "./context";
import {
  errorMessageFromJsonBody,
  parseJsonResponseBody,
} from "./json-response";
import { projectMetadataDetailSchema } from "./schemas";
import type { ProjectMetadataDetail } from "./schemas";

export async function fetchProjectMetadataDetail(
  ctx: ApiClientContext,
  hash: string,
): Promise<ProjectMetadataDetail> {
  const token = ctx.tokenOrThrow();
  const url = `${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(hash)}/metadata`;
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
    `CLI project metadata: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
  );
  if (!res.ok) {
    throw new Error(errorMessageFromJsonBody(raw, res.status));
  }
  const body = raw as { metadata?: unknown };
  const parsed = projectMetadataDetailSchema.safeParse(body.metadata);
  if (!parsed.success) {
    throw new Error("CLI project metadata: unexpected response shape.");
  }
  return parsed.data;
}

export async function patchProjectMetadata(
  ctx: ApiClientContext,
  hash: string,
  patch: { description?: string | null; brief?: string | null },
): Promise<ProjectMetadataDetail> {
  const token = ctx.tokenOrThrow();
  const url = `${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(hash)}/metadata`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
  if (res.status === 401) {
    throw new Error("Invalid or expired API token. Run `flux login`.");
  }
  const text = await res.text();
  const raw = parseJsonResponseBody(
    text,
    `CLI project metadata: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
  );
  if (!res.ok) {
    throw new Error(errorMessageFromJsonBody(raw, res.status));
  }
  const body = raw as { metadata?: unknown };
  const parsed = projectMetadataDetailSchema.safeParse(body.metadata);
  if (!parsed.success) {
    throw new Error("CLI project metadata: unexpected response shape.");
  }
  return parsed.data;
}

import {
  slugifyProjectName,
  type FluxProjectEnvEntry,
} from "@flux/core/standalone";
import type { ApiClientContext } from "./context";
import {
  errorMessageFromJsonBody,
  parseJsonResponseBody,
} from "./json-response";
import { projectEnvListResponseSchema } from "./schemas";

export async function listProjectEnv(
  ctx: ApiClientContext,
  project: string,
  hash: string,
): Promise<FluxProjectEnvEntry[]> {
  const token = ctx.tokenOrThrow();
  const slug = slugifyProjectName(project);
  const u = new URL(
    `${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(hash)}/api-env`,
  );
  u.searchParams.set("slug", slug);
  const res = await fetch(u, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (res.status === 401) {
    throw new Error("Invalid or expired API token. Run `flux login`.");
  }
  const text = await res.text();
  const body = parseJsonResponseBody(
    text,
    `CLI env list: response was not JSON (${String(res.status)}). Check FLUX_API_BASE.`,
  );
  if (!res.ok) {
    throw new Error(errorMessageFromJsonBody(body, res.status));
  }
  const parsed = projectEnvListResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      "CLI env list: response did not match expected env entry shape.",
    );
  }
  return parsed.data;
}

export async function setProjectEnv(
  ctx: ApiClientContext,
  project: string,
  env: Record<string, string>,
  hash: string,
): Promise<void> {
  const token = ctx.tokenOrThrow();
  const slug = slugifyProjectName(project);
  const u = new URL(
    `${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(hash)}/api-env`,
  );
  u.searchParams.set("slug", slug);
  const res = await fetch(u, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ env }),
  });
  if (res.status === 401) {
    throw new Error("Invalid or expired API token. Run `flux login`.");
  }
  const text = await res.text();
  const body = parseJsonResponseBody(
    text,
    `CLI env set: response was not JSON (${String(res.status)}). Check FLUX_API_BASE.`,
  );
  if (!res.ok) {
    throw new Error(errorMessageFromJsonBody(body, res.status));
  }
}

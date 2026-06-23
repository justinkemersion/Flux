import type { ApiClientContext } from "./context";
import {
  errorMessageFromJsonBody,
  parseJsonResponseBody,
} from "./json-response";
import type { ProjectLifecycleAction } from "@flux/core/project-lifecycle-state";
import type { ProjectLifecycleState } from "@flux/core/project-lifecycle-state";

export type ProjectLifecycleInfo = {
  slug: string;
  hash: string;
  name: string;
  lifecycleState: ProjectLifecycleState;
  summary: string;
  activeCount: number;
  activeLimit: number;
  plan: "hobby" | "pro";
};

export async function getProjectLifecycleState(
  ctx: ApiClientContext,
  hash: string,
): Promise<ProjectLifecycleInfo> {
  const token = ctx.tokenOrThrow();
  const h = hash.trim().toLowerCase();
  const url = `${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(h)}/lifecycle-state`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  const body = parseJsonResponseBody(
    text,
    `CLI lifecycle state: response was not JSON (${String(res.status)}). Check FLUX_API_BASE.`,
  );
  if (res.status === 401) {
    throw new Error("Invalid or expired API token. Run `flux login`.");
  }
  if (!res.ok) {
    throw new Error(errorMessageFromJsonBody(body, res.status));
  }
  if (
    !body ||
    typeof body !== "object" ||
    !("lifecycle" in body) ||
    !(body as { lifecycle: unknown }).lifecycle
  ) {
    throw new Error("CLI lifecycle state: unexpected response shape.");
  }
  return (body as { lifecycle: ProjectLifecycleInfo }).lifecycle;
}

export async function runProjectLifecycleAction(
  ctx: ApiClientContext,
  hash: string,
  action: ProjectLifecycleAction,
): Promise<{ lifecycleState: ProjectLifecycleState; noop?: boolean }> {
  const token = ctx.tokenOrThrow();
  const h = hash.trim().toLowerCase();
  const url = `${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(h)}/lifecycle-state`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action }),
  });
  const text = await res.text();
  const body = parseJsonResponseBody(
    text,
    `CLI lifecycle state: response was not JSON (${String(res.status)}). Check FLUX_API_BASE.`,
  );
  if (res.status === 401) {
    throw new Error("Invalid or expired API token. Run `flux login`.");
  }
  if (!res.ok) {
    throw new Error(errorMessageFromJsonBody(body, res.status));
  }
  if (
    !body ||
    typeof body !== "object" ||
    !("lifecycleState" in body) ||
    typeof (body as { lifecycleState: unknown }).lifecycleState !== "string"
  ) {
    throw new Error("CLI lifecycle state: unexpected response shape.");
  }
  const parsed = body as {
    lifecycleState: ProjectLifecycleState;
    noop?: boolean;
  };
  return {
    lifecycleState: parsed.lifecycleState,
    ...(parsed.noop ? { noop: true } : {}),
  };
}

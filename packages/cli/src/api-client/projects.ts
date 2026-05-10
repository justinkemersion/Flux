import {
  FLUX_PROJECT_HASH_HEX_LEN,
  type FluxProjectSummary,
  slugifyProjectName,
} from "@flux/core/standalone";
import type { ApiClientContext } from "./context";
import {
  errorMessageFromJsonBody,
  parseJsonResponseBody,
} from "./json-response";
import {
  createProjectResponseSchema,
  listProjectsResponseSchema,
  projectCredentialsResponseSchema,
  projectMetadataSchema,
  nukeProjectSuccessSchema,
  verifyTokenResponseSchema,
  type CreateProjectMode,
  type CreateProjectResult,
  type ProjectCredentialsByHash,
  type ProjectMetadata,
  type VerifyTokenResult,
} from "./schemas";

export async function verifyToken(
  ctx: ApiClientContext,
  token: string,
): Promise<VerifyTokenResult> {
  const t = token.trim();
  if (!t) {
    throw new Error("Empty API token.");
  }
  const url = `${ctx.baseUrl}/cli/v1/auth/verify`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${t}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  const raw = parseJsonResponseBody(
    text,
    `CLI verify: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
  );
  if (res.status === 401) {
    throw new Error("Invalid or expired API token.");
  }
  if (!res.ok) {
    throw new Error(errorMessageFromJsonBody(raw, res.status));
  }
  const parsed = verifyTokenResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("CLI verify: response did not match expected profile shape.");
  }
  return parsed.data;
}

export async function getProjectMetadata(
  ctx: ApiClientContext,
  hash: string,
): Promise<ProjectMetadata> {
  const token = ctx.tokenOrThrow();
  const h = hash.trim().toLowerCase();
  if (!/^[a-f0-9]{7}$/u.test(h)) {
    throw new Error("Project hash must be a 7-char hex id.");
  }
  const url = `${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(h)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  const body = parseJsonResponseBody(
    text,
    `CLI project metadata: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
  );
  if (res.status === 401) {
    throw new Error("Invalid or expired API token. Run `flux login`.");
  }
  if (!res.ok) {
    throw new Error(errorMessageFromJsonBody(body, res.status));
  }
  const parsed = projectMetadataSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      "CLI project metadata: response did not match expected { slug, hash, mode } shape.",
    );
  }
  return parsed.data;
}

export async function listProjects(
  ctx: ApiClientContext,
): Promise<FluxProjectSummary[]> {
  const token = ctx.tokenOrThrow();
  const url = `${ctx.baseUrl}/cli/v1/list`;
  const res = await fetch(url, {
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
    `CLI list: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
  );
  if (!res.ok) {
    throw new Error(errorMessageFromJsonBody(body, res.status));
  }
  const parsed = listProjectsResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      "CLI list: response did not match expected FluxProjectSummary[] shape.",
    );
  }
  return parsed.data;
}

export async function createProject(
  ctx: ApiClientContext,
  input: {
    name: string;
    stripSupabaseRestPrefix: boolean;
    mode?: CreateProjectMode;
  },
): Promise<CreateProjectResult> {
  const token = ctx.tokenOrThrow();
  const url = `${ctx.baseUrl}/cli/v1/create`;
  const body: {
    name: string;
    stripSupabaseRestPrefix?: boolean;
    mode?: CreateProjectMode;
  } = {
    name: input.name.trim(),
  };
  if (input.stripSupabaseRestPrefix === false) {
    body.stripSupabaseRestPrefix = false;
  }
  if (input.mode) {
    body.mode = input.mode;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    throw new Error("Invalid or expired API token. Run `flux login`.");
  }
  const text = await res.text();
  const raw = parseJsonResponseBody(
    text,
    `CLI create: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
  );
  if (!res.ok) {
    throw new Error(errorMessageFromJsonBody(raw, res.status));
  }
  const parsed = createProjectResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      "CLI create: response did not match expected { summary, mode, secrets } shape.",
    );
  }
  return parsed.data;
}

export async function getProjectCredentialsByHash(
  ctx: ApiClientContext,
  hash: string,
): Promise<ProjectCredentialsByHash> {
  const token = ctx.tokenOrThrow();
  const h = hash.trim().toLowerCase();
  const hexLen = FLUX_PROJECT_HASH_HEX_LEN;
  if (h.length !== hexLen || !/^[a-f0-9]+$/u.test(h)) {
    throw new Error(
      `Project hash must be a ${String(hexLen)}-character lowercase hex id.`,
    );
  }
  const url = `${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(h)}/credentials`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  const raw = parseJsonResponseBody(
    text,
    `CLI credentials: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
  );
  if (res.status === 401) {
    throw new Error("Invalid or expired API token. Run `flux login`.");
  }
  if (!res.ok) {
    throw new Error(errorMessageFromJsonBody(raw, res.status));
  }
  const parsed = projectCredentialsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      "CLI credentials: response did not match expected credentials shape.",
    );
  }
  return parsed.data;
}

async function runLifecycle(
  ctx: ApiClientContext,
  _project: string,
  hash: string,
  action: "start" | "stop",
): Promise<void> {
  const token = ctx.tokenOrThrow();
  const h = hash.trim().toLowerCase();
  const url = `${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(
    h,
  )}/lifecycle`;
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
    `CLI lifecycle: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
  );
  if (res.status === 401) {
    throw new Error("Invalid or expired API token. Run `flux login`.");
  }
  if (!res.ok) {
    throw new Error(errorMessageFromJsonBody(body, res.status));
  }
}

export function stopProject(
  ctx: ApiClientContext,
  project: string,
  hash: string,
): Promise<void> {
  return runLifecycle(ctx, project, hash, "stop");
}

export function startProject(
  ctx: ApiClientContext,
  project: string,
  hash: string,
): Promise<void> {
  return runLifecycle(ctx, project, hash, "start");
}

export async function nukeProject(
  ctx: ApiClientContext,
  project: string,
  hash: string,
  options?: { forceOrphan?: boolean },
): Promise<{ mode: "catalog" | "orphan" }> {
  const token = ctx.tokenOrThrow();
  const slug = slugifyProjectName(project);
  const u = new URL(`${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(hash)}`);
  if (options?.forceOrphan) {
    u.searchParams.set("force", "1");
    u.searchParams.set("slug", slug);
  }
  const res = await fetch(u, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  const body = parseJsonResponseBody(
    text,
    `CLI nuke: response was not JSON (${String(res.status)}). Check FLUX_API_BASE.`,
  );
  if (res.status === 401) {
    throw new Error("Invalid or expired API token. Run `flux login`.");
  }
  if (res.status === 404) {
    const errMsg =
      body &&
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : "No project in catalog for this hash";
    const hint =
      !options?.forceOrphan
        ? " If infrastructure still exists without a DB row, run again with: flux nuke --force -y (same name/hash as flux.json)."
        : "";
    throw new Error(`${errMsg}${hint}`);
  }
  if (!res.ok) {
    throw new Error(errorMessageFromJsonBody(body, res.status));
  }
  const parsed = nukeProjectSuccessSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("CLI nuke: success response had unexpected shape.");
  }
  return { mode: parsed.data.mode };
}

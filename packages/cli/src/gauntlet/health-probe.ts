import { mintServiceRoleJwt } from "../lib/migrations-remote";
import type { GauntletMode } from "./types";

export interface PostgrestHealthInput {
  apiUrl: string;
  apiSchema: string;
  mode: GauntletMode;
  hash: string;
  serviceRoleJwt?: string;
  projectJwt?: string;
  maxAttempts?: number;
}

export interface PostgrestHealthResult {
  openapi: Record<string, unknown>;
  httpStatus: number;
  attempts: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveAuthToken(input: PostgrestHealthInput): string {
  if (input.mode === "v1_dedicated") {
    if (!input.serviceRoleJwt?.trim()) {
      throw new Error(
        "v1_dedicated health probe requires serviceRoleJwt from project credentials",
      );
    }
    return input.serviceRoleJwt.trim();
  }
  if (!input.projectJwt?.trim()) {
    throw new Error(
      "v2_shared health probe requires projectJwt from create/credentials",
    );
  }
  return mintServiceRoleJwt(input.projectJwt.trim(), input.hash);
}

function profileHeaders(
  mode: GauntletMode,
  apiSchema: string,
): Record<string, string> {
  if (mode === "v2_shared" || apiSchema !== "api") {
    return { "Accept-Profile": apiSchema };
  }
  return {};
}

function assertOpenApiDocument(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") {
    throw new Error("PostgREST root did not return a JSON object");
  }
  const doc = body as Record<string, unknown>;
  const hasOpenApi =
    typeof doc.openapi === "string" ||
    typeof doc.swagger === "string" ||
    (doc.paths !== undefined && typeof doc.paths === "object");
  if (!hasOpenApi) {
    throw new Error(
      "PostgREST root response is not an OpenAPI document (missing openapi/swagger/paths)",
    );
  }
  return doc;
}

async function probeOnce(input: PostgrestHealthInput): Promise<Response> {
  const base = input.apiUrl.replace(/\/$/, "");
  const url = `${base}/`;
  const token = resolveAuthToken(input);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/openapi+json",
    ...profileHeaders(input.mode, input.apiSchema),
  };
  return fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(20_000),
  });
}

/**
 * Poll until PostgREST returns a valid OpenAPI document — not merely “not 502”.
 */
export async function assertPostgrestHealthy(
  input: PostgrestHealthInput,
): Promise<PostgrestHealthResult> {
  const maxAttempts = input.maxAttempts ?? 40;
  let lastError = "unknown";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await probeOnce(input);
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        lastError = `gateway not ready: HTTP ${String(res.status)}`;
      } else if (!res.ok) {
        const text = await res.text().catch(() => "");
        lastError = `PostgREST OpenAPI probe failed: HTTP ${String(res.status)} ${text.slice(0, 200)}`;
      } else {
        const body: unknown = await res.json();
        const openapi = assertOpenApiDocument(body);
        return { openapi, httpStatus: res.status, attempts: attempt };
      }
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    if (attempt < maxAttempts) {
      await sleep(Math.min(400 * 2 ** Math.min(attempt, 5), 5000));
    }
  }

  throw new Error(
    `PostgREST did not become healthy after ${String(maxAttempts)} attempts: ${lastError}`,
  );
}

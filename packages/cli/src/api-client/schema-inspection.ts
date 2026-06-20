import type { SchemaInspectionResult } from "@flux/core/schema-inspection";
import type { ApiClientContext } from "./context";
import {
  errorMessageFromJsonBody,
  parseJsonResponseBody,
} from "./json-response";

export async function schemaInspectProject(
  ctx: ApiClientContext,
  input: { hash: string; includeExactCounts?: boolean },
): Promise<SchemaInspectionResult> {
  const token = ctx.tokenOrThrow();
  const hash = input.hash.trim().toLowerCase();
  const url = `${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(hash)}/schema-inspection`;
  const body: { includeExactCounts?: boolean } = {};
  if (input.includeExactCounts === true) {
    body.includeExactCounts = true;
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
    `CLI schema-inspection: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
  );
  if (!res.ok) {
    throw new Error(errorMessageFromJsonBody(raw, res.status));
  }
  return raw as SchemaInspectionResult;
}

export type { SchemaInspectionResult };

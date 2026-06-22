import type { ApiClientContext } from "./context";
import { errorMessageFromJsonBody, parseJsonResponseBody } from "./json-response";

export type DoctorCheckStatus = "pass" | "warn" | "fail";

export type DoctorCheck = {
  name: string;
  status: DoctorCheckStatus;
  detail: string;
  remediation?: string;
};

export type DoctorReport = {
  projectSlug: string;
  hash: string;
  mode: "v1_dedicated" | "v2_shared";
  schema: string;
  checks: DoctorCheck[];
  overallStatus: DoctorCheckStatus;
  generatedAt: string;
};

export async function runDoctorForHash(
  ctx: ApiClientContext,
  hash: string,
): Promise<DoctorReport> {
  const token = ctx.tokenOrThrow();
  const url = `${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(hash)}/doctor`;
  const res = await fetch(url, {
    method: "POST",
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
    `CLI doctor: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
  );
  if (!res.ok) {
    throw new Error(errorMessageFromJsonBody(raw, res.status));
  }
  return raw as DoctorReport;
}

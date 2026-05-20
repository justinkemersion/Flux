import type { FluxMigrationRecord } from "@flux/core/sql-migrations";
import type { ApiClientContext } from "./context";
import {
  errorMessageFromJsonBody,
  parseJsonResponseBody,
} from "./json-response";

const appliedMigrationsResponseSchema = {
  parse(raw: unknown): { applied: FluxMigrationRecord[] } | null {
    if (!raw || typeof raw !== "object" || !("applied" in raw)) return null;
    const applied = (raw as { applied: unknown }).applied;
    if (!Array.isArray(applied)) return null;
    const rows: FluxMigrationRecord[] = [];
    for (const item of applied) {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      if (
        typeof o.version !== "string" ||
        typeof o.filename !== "string" ||
        typeof o.checksum !== "string"
      ) {
        return null;
      }
      rows.push({
        version: o.version,
        filename: o.filename,
        checksum: o.checksum,
        ...(typeof o.appliedAt === "string" ? { appliedAt: o.appliedAt } : {}),
      });
    }
    return { applied: rows };
  },
};

export async function listAppliedMigrationsV1(
  ctx: ApiClientContext,
  hash: string,
): Promise<FluxMigrationRecord[]> {
  const token = ctx.tokenOrThrow();
  const h = hash.trim().toLowerCase();
  const url = `${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(h)}/migrations`;
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
    `CLI migrations list: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
  );
  if (res.status === 401) {
    throw new Error("Invalid or expired API token. Run `flux login`.");
  }
  if (!res.ok) {
    throw new Error(errorMessageFromJsonBody(raw, res.status));
  }
  const parsed = appliedMigrationsResponseSchema.parse(raw);
  if (!parsed) {
    throw new Error("CLI migrations list: unexpected response shape.");
  }
  return parsed.applied;
}

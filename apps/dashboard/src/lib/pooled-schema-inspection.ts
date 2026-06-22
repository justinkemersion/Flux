import pg from "pg";
import type { TenantCatalogQueryFn } from "@flux/core/schema-inspection";
import { quoteIdent } from "./pooled-push.ts";

function resolveSharedPostgresUrl(): string {
  const url = process.env.FLUX_SHARED_POSTGRES_URL?.trim();
  if (!url) {
    throw new Error(
      "FLUX_SHARED_POSTGRES_URL is not set on the control plane.",
    );
  }
  return url;
}

/**
 * Returns a TenantCatalogQueryFn backed by the shared Postgres cluster.
 *
 * Each call opens a dedicated pg.Client scoped to the tenant schema via
 * SET search_path, runs the fixed catalog SQL, and tears down the connection.
 * This mirrors the per-exec pattern used by the v1 Docker exec path — the
 * total request is already bounded by the 60 s timeout in inspectTenantSchema.
 *
 * The admin URL is never forwarded to clients; it is used server-side only.
 */
export function createPooledTenantCatalogQueryFn(
  tenantSchema: string,
): TenantCatalogQueryFn {
  return async (sql: string): Promise<unknown[]> => {
    const client = new pg.Client({ connectionString: resolveSharedPostgresUrl() });
    await client.connect();
    try {
      await client.query("SET statement_timeout = '30s'");
      await client.query(
        `SET search_path TO ${quoteIdent(tenantSchema)}, public`,
      );
      const result = await client.query(sql);
      return (result as { rows: unknown[] }).rows;
    } finally {
      await client.end().catch(() => undefined);
    }
  };
}

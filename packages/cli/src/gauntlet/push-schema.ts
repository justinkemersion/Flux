import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getApiClient } from "../api-client";
import { resolveDashboardBase } from "../dashboard-base";
import { formatV2ServerError, mintServiceRoleJwt } from "../lib/migrations-remote";
import { buildGauntletSchemaSql } from "./schema-fixtures";
import type { GauntletProjectCtx } from "./types";

const MAX_SQL_BYTES = 4 * 1024 * 1024;

/** Write schema.sql into the run report directory (artifact + push source). */
export async function writeSchemaArtifact(
  reportDir: string,
  apiSchema: string,
): Promise<string> {
  await mkdir(reportDir, { recursive: true });
  const schemaSqlPath = join(reportDir, "schema.sql");
  const sql = buildGauntletSchemaSql(apiSchema);
  await writeFile(schemaSqlPath, `${sql}\n`, "utf8");
  return schemaSqlPath;
}

export interface PushSchemaResult {
  schemaSqlPath: string;
  tablesMoved?: number;
  mode: "v1_cli_push" | "v2_dashboard_push";
}

async function pushSchemaV1(
  ctx: GauntletProjectCtx,
  schemaSqlPath: string,
): Promise<PushSchemaResult> {
  const client = getApiClient();
  const result = await client.importSqlFile(ctx.slug, schemaSqlPath, ctx.hash, {
    supabaseCompat: false,
    sanitizeForTarget: true,
    moveFromPublic: false,
  });
  return {
    schemaSqlPath,
    tablesMoved: result.tablesMoved,
    mode: "v1_cli_push",
  };
}

async function pushSchemaV2(
  ctx: GauntletProjectCtx,
  schemaSqlPath: string,
  sql: string,
): Promise<PushSchemaResult> {
  if (!ctx.projectJwt?.trim()) {
    throw new Error(
      "v2_shared push requires projectJwt from create/credentials (no env fallback in gauntlet)",
    );
  }
  if (Buffer.byteLength(sql, "utf8") > MAX_SQL_BYTES) {
    throw new Error("Gauntlet schema exceeds 4 MiB push limit");
  }

  const token = mintServiceRoleJwt(ctx.projectJwt.trim(), ctx.hash);
  const base = resolveDashboardBase();
  const url = new URL(
    `/api/projects/${encodeURIComponent(ctx.slug)}/push`,
    base.endsWith("/") ? base : `${base}/`,
  );

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      hash: ctx.hash,
      sql,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text.trim() ? (JSON.parse(text) as unknown) : null;
  } catch {
    throw new Error(
      `v2 push response was not JSON (HTTP ${String(res.status)})`,
    );
  }
  if (!res.ok) {
    throw new Error(formatV2ServerError(res.status, body));
  }

  return {
    schemaSqlPath,
    mode: "v2_dashboard_push",
  };
}

/**
 * Push gauntlet schema via existing safe routes only.
 * v1_dedicated: CLI `/cli/v1/push` through importSqlFile (file path).
 * v2_shared: dashboard `/api/projects/:slug/push` when projectJwt is available.
 */
export async function pushGauntletSchema(
  ctx: GauntletProjectCtx,
): Promise<PushSchemaResult> {
  const schemaSqlPath = await writeSchemaArtifact(ctx.reportDir, ctx.apiSchema);
  const sql = buildGauntletSchemaSql(ctx.apiSchema);

  if (ctx.mode === "v1_dedicated") {
    return pushSchemaV1(ctx, schemaSqlPath);
  }

  try {
    return await pushSchemaV2(ctx, schemaSqlPath, sql);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/FLUX_DASHBOARD|dashboard base|ENOTFOUND|fetch failed/i.test(msg)) {
      throw new Error(
        `v2_shared push skipped path unavailable: ${msg}. Use v1_dedicated for full gauntlet coverage.`,
      );
    }
    throw err;
  }
}

import { buildPreviewRowsSql } from "@flux/core/schema-inspection";
import { inspectProjectSchema } from "./project-schema-inspection";
import { createPooledTenantCatalogQueryFn } from "./pooled-schema-inspection";
import { getProjectManager } from "./flux";
import { resolveTenantApiSchemaName } from "@flux/core";

export const PREVIEW_ROW_LIMIT = 50;

export type RowPreviewResult = {
  tableName: string;
  schema: string;
  columns: string[];
  rows: Record<string, unknown>[];
};

type ProjectLookupRow = {
  id: string;
  slug: string;
  hash: string;
  mode: string;
  apiSchemaName: string | null;
  apiSchemaStrategy: string | null;
};

/**
 * Fetches a bounded row preview for a single table.
 *
 * Validation steps:
 * 1. Run schema inspection to get the confirmed table list for this project.
 * 2. Find the requested table by name (case-insensitive, returns exact name).
 * 3. Build the preview SQL using buildPreviewRowsSql (identifier-validated,
 *    server-enforced LIMIT).
 * 4. Execute via the mode-appropriate query path.
 *
 * This is a project-owner/admin inspection view, not a PostgREST/RLS
 * simulation. Never expose the admin URL or credentials to the client.
 */
export async function fetchProjectTableRows(
  project: ProjectLookupRow,
  requestedTableName: string,
): Promise<RowPreviewResult> {
  const inspection = await inspectProjectSchema(project);

  const match = inspection.tables.find(
    (t) => t.name.toLowerCase() === requestedTableName.toLowerCase(),
  );

  if (!match) {
    const available = inspection.tables.map((t) => t.name).join(", ") || "(none)";
    throw new Error(
      `Table "${requestedTableName}" not found in schema "${inspection.project.schema}". Available: ${available}`,
    );
  }

  const apiSchema = resolveTenantApiSchemaName({
    id: project.id,
    mode: project.mode as "v1_dedicated" | "v2_shared",
    apiSchemaName: project.apiSchemaName,
    apiSchemaStrategy: project.apiSchemaStrategy as
      | "legacy_api"
      | "tenant_schema"
      | null,
  });

  const previewSql = buildPreviewRowsSql(
    apiSchema,
    match.name,
    PREVIEW_ROW_LIMIT,
    match.primaryKey,
  );

  let rawRows: unknown[];

  if (project.mode === "v2_shared") {
    const queryFn = createPooledTenantCatalogQueryFn(apiSchema);
    rawRows = await queryFn(previewSql);
  } else {
    const pm = getProjectManager();
    rawRows = await pm.queryTenantJsonRows(project.slug, project.hash, previewSql);
  }

  const rows = rawRows as Record<string, unknown>[];
  const columns =
    rows.length > 0
      ? Object.keys(rows[0])
      : match.columns.map((c) => c.name);

  return {
    tableName: match.name,
    schema: apiSchema,
    columns,
    rows,
  };
}

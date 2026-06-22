import { resolveTenantApiSchemaName } from "@flux/core";
import type { SchemaInspectionResult } from "@flux/core/schema-inspection";
import { getProjectManager } from "./flux";
import { createPooledTenantCatalogQueryFn } from "./pooled-schema-inspection";

type ProjectLookupRow = {
  id: string;
  slug: string;
  hash: string;
  mode: string;
  apiSchemaName: string | null;
  apiSchemaStrategy: string | null;
};

/**
 * Runs read-only schema inspection for a project using its mode-appropriate
 * query path:
 *
 * - v1_dedicated: Docker exec via ProjectManager (requires running container)
 * - v2_shared: shared Postgres admin URL via createPooledTenantCatalogQueryFn
 *
 * The admin URL is never forwarded to the client — this function runs
 * entirely server-side.
 */
export async function inspectProjectSchema(
  project: ProjectLookupRow,
  options?: { includeExactCounts?: boolean },
): Promise<SchemaInspectionResult> {
  const apiSchema = resolveTenantApiSchemaName({
    id: project.id,
    mode: project.mode as "v1_dedicated" | "v2_shared",
    apiSchemaName: project.apiSchemaName,
    apiSchemaStrategy: project.apiSchemaStrategy as
      | "legacy_api"
      | "tenant_schema"
      | null,
  });

  const pm = getProjectManager();
  const queryRows =
    project.mode === "v2_shared"
      ? createPooledTenantCatalogQueryFn(apiSchema)
      : undefined;

  return pm.inspectTenantSchema(
    {
      slug: project.slug,
      hash: project.hash,
      apiSchema,
      mode: project.mode as "v1_dedicated" | "v2_shared",
      includeExactCounts: options?.includeExactCounts ?? false,
    },
    queryRows,
  );
}

import { resolveTenantApiSchemaName } from "@flux/core";
import type { FluxMigrationRecord } from "@flux/core/sql-migrations";
import { listPooledAppliedMigrations } from "./pooled-migrations";
import { getProjectManager } from "./flux";

type ProjectRow = {
  id: string;
  slug: string;
  hash: string;
  mode: string;
  apiSchemaName: string | null;
  apiSchemaStrategy: string | null;
};

export async function listProjectAppliedMigrations(
  project: ProjectRow,
): Promise<FluxMigrationRecord[]> {
  const tenantSchema = resolveTenantApiSchemaName({
    id: project.id,
    mode: project.mode as "v1_dedicated" | "v2_shared",
    apiSchemaName: project.apiSchemaName,
    apiSchemaStrategy: project.apiSchemaStrategy as
      | "legacy_api"
      | "tenant_schema"
      | null,
  });

  if (project.mode === "v2_shared") {
    return listPooledAppliedMigrations({ tenantSchema });
  }

  const pm = getProjectManager();
  return pm.listAppliedSqlMigrations(project.slug, project.hash, tenantSchema);
}

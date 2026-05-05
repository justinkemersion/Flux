import { defaultTenantApiSchemaFromProjectId } from "@flux/core";
import { deriveShortId } from "@flux/core/standalone";

import type { MigrationPlan } from "./types.ts";

export type CatalogProjectLike = {
  id: string;
  slug: string;
  mode: "v1_dedicated" | "v2_shared";
  jwtSecret: string | null;
  hash: string;
};

export function buildMigrationPlanFromCatalogRow(
  row: CatalogProjectLike,
  opts?: {
    preserveJwtSecret?: boolean;
    lockWrites?: boolean;
  },
): MigrationPlan {
  if (row.mode !== "v2_shared") {
    throw new Error(
      `Migration requires v2_shared project; got mode "${row.mode}".`,
    );
  }
  if (!row.jwtSecret?.trim()) {
    throw new Error("Project jwt_secret is missing; repair before migrating.");
  }
  const shortId = deriveShortId(row.id);
  if (!/^[a-f0-9]{12}$/.test(shortId)) {
    throw new Error("Derived shortId is invalid; refusing to migrate.");
  }
  const tenantSchema = defaultTenantApiSchemaFromProjectId(row.id);
  return {
    projectSlug: row.slug,
    projectId: row.id,
    shortId,
    tenantSchema,
    source: { mode: "v2_shared", schema: tenantSchema },
    target: { mode: "v1_dedicated", schema: tenantSchema },
    preserveJwtSecret: opts?.preserveJwtSecret !== false,
    lockWrites: opts?.lockWrites !== false,
  };
}

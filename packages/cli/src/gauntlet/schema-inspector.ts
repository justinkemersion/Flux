import { ProjectManager } from "@flux/core";
import { getApiClient } from "../api-client";
import type { SchemaInspectionResult } from "@flux/core/schema-inspection";
import { SchemaInspectionUnsupportedError } from "@flux/core/schema-inspection";
import type { GauntletMode } from "./types";

export type {
  InspectedColumn,
  InspectedForeignKey,
  InspectedGrant,
  InspectedRelationship,
  InspectedTable,
  RawColumnRow,
  RawForeignKeyRow,
  RawGrantRow,
  RawIndexRow,
  RawPrimaryKeyRow,
  RawTableMetaRow,
  SchemaGraph,
  SchemaGraphEdge,
  SchemaGraphNode,
  SchemaInspectionResult,
  SchemaInspectionSummary,
  SchemaWarning,
  SchemaWarningCode,
  SchemaWarningSeverity,
} from "@flux/core/schema-inspection";

export {
  SchemaInspectionUnsupportedError,
  buildSchemaInspectionSummary,
  generateSchemaWarnings,
  indexColumnsByTable,
  normalizeInspectionRows,
} from "@flux/core/schema-inspection";

export interface InspectProjectSchemaInput {
  slug: string;
  hash: string;
  mode: GauntletMode;
  apiSchema: string;
  apiUrl?: string;
  /** Gauntlet audit runs request exact counts; default false for remote API. */
  includeExactCounts?: boolean;
  projectManager?: ProjectManager;
}

export async function inspectProjectSchema(
  input: InspectProjectSchemaInput,
): Promise<SchemaInspectionResult> {
  if (input.mode !== "v1_dedicated") {
    throw new SchemaInspectionUnsupportedError(input.mode);
  }

  const includeExactCounts =
    input.includeExactCounts === true ||
    process.env.FLUX_SCHEMA_INSPECT_LOCAL === "1";

  if (process.env.FLUX_SCHEMA_INSPECT_LOCAL === "1") {
    const pm = input.projectManager ?? new ProjectManager();
    return pm.inspectTenantSchema({
      slug: input.slug,
      hash: input.hash,
      apiSchema: input.apiSchema,
      ...(input.apiUrl ? { apiUrl: input.apiUrl } : {}),
      includeExactCounts,
    });
  }

  try {
    return await getApiClient().schemaInspectProject({
      hash: input.hash,
      ...(includeExactCounts ? { includeExactCounts: true } : {}),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      /404|501|Cannot POST|schema-inspection|schema_inspection_unsupported/i.test(
        msg,
      )
    ) {
      throw new Error(
        "Schema inspection API unavailable. Deploy dashboard with POST /api/cli/v1/projects/:hash/schema-inspection, " +
          "or set FLUX_SCHEMA_INSPECT_LOCAL=1 when CLI shares Docker with the project host (e.g. DOCKER_HOST=ssh://…). " +
          `Upstream: ${msg.slice(0, 160)}`,
      );
    }
    throw err;
  }
}

/** Assert gauntlet fixture tables survived a failed push or similar disruption. */
export function assertGauntletFixtureTablesPresent(
  result: SchemaInspectionResult,
): void {
  const names = new Set(result.tables.map((t) => t.name));
  if (!names.has("gauntlet_notes") || !names.has("gauntlet_events")) {
    throw new Error(
      `Expected gauntlet_notes and gauntlet_events after disruption; found: ${[...names].join(", ") || "(none)"}`,
    );
  }
}

import { resolve } from "node:path";
import { getApiClient } from "../api-client";
import { inspectProjectSchema } from "../gauntlet/schema-inspector";
import {
  buildSchemaInspectionMarkdownSection,
  writeSchemaInspectionArtifacts,
} from "../gauntlet/schema-story-report";
import { SchemaInspectionUnsupportedError } from "@flux/core/schema-inspection";

export interface CmdGauntletInspectSchemaOptions {
  project?: string;
  hash?: string;
  reportDir?: string;
  json?: boolean;
}

const DEFAULT_REPORT_DIR = "reports/gauntlet";

export async function cmdGauntletInspectSchema(
  options: CmdGauntletInspectSchemaOptions,
): Promise<void> {
  const slug = options.project?.trim();
  const hash = options.hash?.trim();
  if (!slug || !hash) {
    throw new Error(
      "flux gauntlet inspect-schema requires --project <slug> and --hash <hash>",
    );
  }

  const client = getApiClient();
  const metadata = await client.getProjectMetadata(hash);
  if (metadata.mode !== "v1_dedicated") {
    throw new SchemaInspectionUnsupportedError(metadata.mode);
  }

  const apiSchema = metadata.apiSchema ?? "api";
  const inspection = await inspectProjectSchema({
    slug,
    hash,
    mode: "v1_dedicated",
    apiSchema,
    includeExactCounts: true,
  });

  const reportRoot = resolve(
    process.cwd(),
    options.reportDir?.trim() || DEFAULT_REPORT_DIR,
  );
  const reportDir = resolve(reportRoot, `inspect-schema-${slug}-${hash}`);
  await writeSchemaInspectionArtifacts({ reportDir, result: inspection });

  if (options.json === true) {
    console.log(JSON.stringify(inspection, null, 2));
  } else {
    console.log(buildSchemaInspectionMarkdownSection(inspection));
    console.log("");
    console.log(`Artifacts: ${reportDir}`);
  }
}

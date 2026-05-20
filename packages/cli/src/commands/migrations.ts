import chalk from "chalk";
import { LEGACY_FLUX_API_SCHEMA } from "@flux/core";
import { getApiClient } from "../api-client";
import { sectionBanner } from "../cli-layout";
import type { FluxJson } from "../flux-config";
import { fetchAppliedMigrations } from "../lib/migrations-remote";
import {
  MIGRATION_EDIT_RULE,
  printMigrationLedger,
} from "../lib/migrations-output";
import { resolveHash, resolveProjectSlug } from "../project-resolve";

export async function cmdMigrationsList(
  project: string,
  options: { hash?: string },
  flux: FluxJson | null,
): Promise<void> {
  const slug = resolveProjectSlug(project, flux, "-p, --project");
  const hash = resolveHash(options.hash, flux);
  const client = getApiClient();
  const metadata = await client.getProjectMetadata(hash);

  const schemaHint =
    metadata.mode === "v1_dedicated"
      ? `${metadata.mode}, schema ${metadata.apiSchema ?? LEGACY_FLUX_API_SCHEMA}`
      : metadata.mode;

  sectionBanner("Flux migrations");
  const applied = await fetchAppliedMigrations({
    slug,
    hash,
    mode: metadata.mode,
  });
  printMigrationLedger({ slug, schemaHint, applied });
  console.log();
  console.log(chalk.dim(MIGRATION_EDIT_RULE));
}

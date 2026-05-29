import chalk from "chalk";
import { getApiClient } from "../api-client";
import type { FluxJson } from "../flux-config";
import { resolveHash, resolveProjectSlug } from "../project-resolve";
import { ensureRestoreVerifiedLatestBackup } from "./backup-gate";

export async function cmdDbReset(
  project: string,
  yes: boolean,
  skipBackupCheck: boolean,
  cliHash: string | undefined,
  flux: FluxJson | null,
): Promise<void> {
  if (!yes) {
    throw new Error(
      "Refusing db-reset: pass --yes to drop public and auth schemas and all data in them.",
    );
  }
  const slug = resolveProjectSlug(project, flux, "-p, --project");
  const client = getApiClient();
  const hash = resolveHash(cliHash, flux);
  await ensureRestoreVerifiedLatestBackup(client, hash, skipBackupCheck);
  console.log(
    chalk.blue(
      `Resetting database for ${chalk.bold(slug)} (drop public + auth, reapply Flux bootstrap)…`,
    ),
  );
  await client.resetTenantDatabaseForImport(slug, hash);
  console.log(
    chalk.green("✓"),
    chalk.white("Database reset. You can run"),
    chalk.cyan("flux push"),
    chalk.white("with a plain SQL file."),
  );
}

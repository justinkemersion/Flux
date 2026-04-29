import chalk from "chalk";
import { getApiClient } from "../api-client";
import { hintLine } from "../cli-layout";
import type { FluxJson } from "../flux-config";
import { printGatewayJwtEnvCopyBlock } from "../print-gateway-env-snippet";
import { resolveHash, resolveOptionalName } from "../project-resolve";

export async function cmdProjectCredentials(
  name: string | undefined,
  cliHash: string | undefined,
  flux: FluxJson | null,
): Promise<void> {
  const slug = resolveOptionalName(name, flux, "positional <name> argument");
  const hash = resolveHash(cliHash, flux);
  const client = getApiClient();
  const creds = await client.getProjectCredentialsByHash(hash);

  if (creds.mode === "v2_shared") {
    console.log(
      chalk.blue(`Credentials for ${chalk.bold(slug)} (${chalk.bold(hash)}) — v2_shared`),
    );
    console.log();
    printGatewayJwtEnvCopyBlock(creds.projectJwtSecret);
    for (const line of creds.note.match(/.{1,76}/g) ?? [creds.note]) {
      hintLine(line);
    }
    console.log();
    return;
  }

  console.log(
    chalk.blue(`Credentials for ${chalk.bold(slug)} (${chalk.bold(hash)}) — v1_dedicated`),
  );
  console.log();
  if (creds.projectJwtSecret) {
    printGatewayJwtEnvCopyBlock(creds.projectJwtSecret);
  }
  console.log(chalk.cyan("Postgres"));
  console.log(chalk.white(creds.postgresConnectionString));
  console.log();
  console.log(chalk.cyan("Anon key"));
  console.log(chalk.white(creds.anonKey));
  console.log();
  console.log(chalk.magenta("Service role key"));
  console.log(chalk.white(creds.serviceRoleKey));
  console.log();
  hintLine("Keep the service role key secret; it bypasses RLS.");
  console.log();
}

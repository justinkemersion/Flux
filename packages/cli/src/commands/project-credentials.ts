import chalk from "chalk";
import type { ProjectCredentialsByHash } from "../api-client/schemas";
import { getApiClient } from "../api-client";
import type { FluxJson } from "../flux-config";
import {
  buildV1PostgresCredentialSectionLines,
  parsePostgresConnectionFields,
  resolvePostgresCredentialField,
  unsupportedPostgresFieldForV2Message,
} from "../postgres-connection-fields";
import { printGatewayJwtEnvCopyBlock } from "../print-gateway-env-snippet";
import { resolveHash, resolveOptionalName } from "../project-resolve";

export type ProjectCredentialsOptions = {
  field?: string;
};

export async function cmdProjectCredentials(
  name: string | undefined,
  cliHash: string | undefined,
  flux: FluxJson | null,
  options: ProjectCredentialsOptions = {},
): Promise<void> {
  const slug = resolveOptionalName(name, flux, "positional <name> argument");
  const hash = resolveHash(cliHash, flux);
  const client = getApiClient();
  const creds = await client.getProjectCredentialsByHash(hash);
  const field = options.field?.trim();

  if (field) {
    printCredentialField(creds, field);
    return;
  }

  if (creds.mode === "v2_shared") {
    console.log(
      chalk.blue(`Credentials for ${chalk.bold(slug)} (${chalk.bold(hash)}) — v2_shared`),
    );
    console.log();
    printGatewayJwtEnvCopyBlock(creds.projectJwtSecret);
    for (const line of creds.note.match(/.{1,76}/g) ?? [creds.note]) {
      console.log(chalk.dim(`  ${line}`));
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
  printV1PostgresSection(creds.postgresConnectionString);
  console.log(chalk.cyan("  Anon key"));
  console.log(chalk.white(`  ${creds.anonKey}`));
  console.log();
  console.log(chalk.magenta("  Service role key"));
  console.log(chalk.white(`  ${creds.serviceRoleKey}`));
  console.log();
  console.log(
    chalk.dim("  Keep the service role key secret; it bypasses RLS."),
  );
  console.log();
}

function printCredentialField(creds: ProjectCredentialsByHash, field: string): void {
  if (creds.mode === "v2_shared") {
    throw new Error(unsupportedPostgresFieldForV2Message());
  }
  const fields = parsePostgresConnectionFields(creds.postgresConnectionString);
  console.log(resolvePostgresCredentialField(fields, field));
}

function printV1PostgresSection(connectionString: string): void {
  const fields = parsePostgresConnectionFields(connectionString);
  const lines = buildV1PostgresCredentialSectionLines(fields);

  console.log(chalk.cyan("  Postgres"));
  for (const line of lines) {
    if (line === "Postgres") {
      continue;
    }
    if (line === "Connection URL") {
      console.log();
      console.log(chalk.cyan("  Connection URL"));
      continue;
    }
    if (line.startsWith("─")) {
      console.log(chalk.dim(`  ${line}`));
      continue;
    }
    if (line.length === 0) {
      console.log();
      continue;
    }
    console.log(chalk.white(`  ${line}`));
  }
  console.log();
}

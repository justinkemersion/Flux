#!/usr/bin/env node

import { configureCliProcessForAudience } from "./utils/cli-audience";

configureCliProcessForAudience();

// Re-export SDK for bundling and programmatic use of PostgREST client types.
export {
  type FluxActivityOptions,
  type FluxClientOptions,
  createClient,
  FluxClient,
  type FluxResult,
  inferFluxTenantHashFromPostgrestUrl,
  inferFluxTenantSlugFromPostgrestUrl,
} from "@flux/sdk";

import { Command } from "commander";
import { fatalString, runVersionOutput } from "./cli-handlers";
import { registerFluxCliCommands } from "./commands/register-cli";
import { parseVersionInvocation } from "./lib/version-invocation";
import { printErrorAndExit } from "./output/cli-errors";
import { hydrateProcessEnvFromProjectFiles } from "./utils/env-file";

async function main(): Promise<void> {
  process.on("uncaughtException", (err: unknown) => {
    process.stderr.write(`\nFatal: ${fatalString(err)}\n`);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason: unknown) => {
    process.stderr.write(`\nFatal: ${fatalString(reason)}\n`);
    process.exit(1);
  });

  await hydrateProcessEnvFromProjectFiles(process.cwd());

  const versionInvocation = parseVersionInvocation(process.argv.slice(2));
  if (versionInvocation) {
    try {
      await runVersionOutput(versionInvocation);
    } catch (e) {
      printErrorAndExit(e);
    }
    return;
  }

  const program = new Command();
  registerFluxCliCommands(program);
  await program.parseAsync(process.argv);
}

void main().catch((err: unknown) => {
  process.stderr.write(`${fatalString(err)}\n`);
  process.exit(1);
});

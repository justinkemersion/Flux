import { type Command } from "commander";
import { cmdEnvList, cmdEnvSet } from "../../cli-handlers";
import { cliActionWithFlux, HASH_FLAG_DESC } from "./shared";

export function registerEnvCommands(program: Command): void {
  const envRoot = program
    .command("env")
    .description("Read or update PostgREST (API) container environment (when API is available)");

  const envSet = envRoot
    .command("set")
    .description("Set KEY=value entries on the API container environment")
    .argument("<pairs...>", "one or more KEY=value entries")
    .option(
      "-p, --project <name>",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option("--hash <hex>", HASH_FLAG_DESC);

  envSet.action(
    cliActionWithFlux(async (flux, pairs: string[]) => {
      const opts = envSet.opts<{ project?: string; hash?: string }>();
      await cmdEnvSet(opts.project ?? "", pairs, opts.hash, flux);
    }),
  );

  const envList = envRoot
    .command("list")
    .description("List env keys on the API container (sensitive values hidden when applicable)")
    .option(
      "-p, --project <name>",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option("--hash <hex>", HASH_FLAG_DESC);

  envList.action(
    cliActionWithFlux(async (flux) => {
      const opts = envList.opts<{ project?: string; hash?: string }>();
      await cmdEnvList(opts.project ?? "", opts.hash, flux);
    }),
  );
}

import { type Command } from "commander";
import {
  cmdKeys,
  cmdNuke,
  cmdReap,
  cmdStart,
  cmdStop,
} from "../../cli-handlers";
import { cliAction, cliActionWithFlux, HASH_FLAG_DESC } from "./shared";

export function registerLifecycleCommands(program: Command): void {
  const keysCmd = program
    .command("keys")
    .description("Print anon and service_role JWTs for a project (when API is available)")
    .argument(
      "[name]",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option("--hash <hex>", HASH_FLAG_DESC);

  keysCmd.action(
    cliActionWithFlux(async (flux, name: string | undefined) => {
      const opts = keysCmd.opts<{ hash?: string }>();
      await cmdKeys(name, opts.hash, flux);
    }),
  );

  const stopCmd = program
    .command("stop")
    .description("Stop Postgres and PostgREST for a project (when API is available)")
    .argument(
      "[name]",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option("--hash <hex>", HASH_FLAG_DESC);

  stopCmd.action(
    cliActionWithFlux(async (flux, name: string | undefined) => {
      const opts = stopCmd.opts<{ hash?: string }>();
      await cmdStop(name, opts.hash, flux);
    }),
  );

  const startCmd = program
    .command("start")
    .description("Start Postgres and PostgREST for a project (when API is available)")
    .argument(
      "[name]",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option("--hash <hex>", HASH_FLAG_DESC);

  startCmd.action(
    cliActionWithFlux(async (flux, name: string | undefined) => {
      const opts = startCmd.opts<{ hash?: string }>();
      await cmdStart(name, opts.hash, flux);
    }),
  );

  const nukeCmd = program
    .command("nuke")
    .description(
      "Atomic nuke: remove project catalog row, telemetry, and Docker stack (API + DB + data volume + net)",
    )
    .argument(
      "[name]",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option(
      "-y, --yes",
      "Skip slug confirmation prompt (without -y, you must type the exact project slug)",
      false,
    )
    .option(
      "--force",
      "No catalog row: still purge orphaned Docker resources for this slug+hash (same flux.json)",
      false,
    )
    .option(
      "--skip-backup-check",
      "Allow nuke even when the latest backup is not restore-verified (dangerous)",
      false,
    )
    .option("--hash <hex>", HASH_FLAG_DESC);

  nukeCmd.action(
    cliActionWithFlux(async (flux, name: string | undefined) => {
      const opts = nukeCmd.opts<{
        yes: boolean;
        force?: boolean;
        skipBackupCheck: boolean;
        hash?: string;
      }>();
      await cmdNuke(
        name,
        opts.yes,
        opts.force === true,
        opts.skipBackupCheck === true,
        opts.hash,
        flux,
      );
    }),
  );

  program
    .command("reap")
    .description("Stop idle projects past a threshold (control plane; flux-system not implied)")
    .requiredOption(
      "--hours <n>",
      "Idle threshold in hours (positive number)",
    )
    .action(
      cliAction(async (opts: { hours: string }) => {
        const hours = Number(opts.hours);
        if (!Number.isFinite(hours) || hours <= 0) {
          throw new Error("--hours must be a positive number.");
        }
        await cmdReap(hours);
      }),
    );
}

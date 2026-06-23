import { type Command } from "commander";
import { cmdActivity } from "../activity";
import { cliActionWithFlux, HASH_FLAG_DESC } from "./shared";

export function registerActivityCommands(program: Command): void {
  const activityCmd = program
    .command("activity")
    .description("Show recent project activity timeline")
    .option("--hash <hex>", HASH_FLAG_DESC)
    .option(
      "--limit <n>",
      "Maximum events to fetch (default 50, max 100)",
      "50",
    );

  activityCmd.action(
    cliActionWithFlux(async (flux) => {
      const opts = activityCmd.opts<{ hash?: string; limit: string }>();
      const limit = Number(opts.limit);
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new Error("--limit must be a positive number.");
      }
      await cmdActivity(undefined, {
        ...(opts.hash ? { hash: opts.hash } : {}),
        limit,
      }, flux);
    }),
  );

  const projectCmd = program.commands.find((c) => c.name() === "project");
  if (projectCmd) {
    const subCmd = projectCmd
      .command("activity")
      .description("Show recent project activity (alias for flux activity)")
      .option("--hash <hex>", HASH_FLAG_DESC)
      .option("--limit <n>", "Maximum events to fetch (default 50)", "50");

    subCmd.action(
      cliActionWithFlux(async (flux) => {
        const opts = subCmd.opts<{ hash?: string; limit: string }>();
        const limit = Number(opts.limit);
        if (!Number.isFinite(limit) || limit <= 0) {
          throw new Error("--limit must be a positive number.");
        }
        await cmdActivity(undefined, {
        ...(opts.hash ? { hash: opts.hash } : {}),
        limit,
      }, flux);
      }),
    );
  }
}

import { type Command } from "commander";
import { cmdProjectBrief } from "../project-brief";
import { cliActionWithFlux, HASH_FLAG_DESC } from "./shared";

export function registerProjectBriefCommands(program: Command): void {
  const projectCmd = program.commands.find((c) => c.name() === "project");
  if (!projectCmd) return;

  const briefCmd = projectCmd
    .command("brief")
    .description("View or sync repo-root FLUX.md project brief")
    .option("--hash <hex>", HASH_FLAG_DESC)
    .option("--push", "Upload local FLUX.md to the dashboard")
    .option("--prompt", "Print a copyable generation prompt for Cursor/Codex")
    .option("--clear", "Remove the dashboard snapshot (repo file unchanged)");

  briefCmd.action(
    cliActionWithFlux(async (flux) => {
      const opts = briefCmd.opts<{
        hash?: string;
        push?: boolean;
        prompt?: boolean;
        clear?: boolean;
      }>();
      await cmdProjectBrief(undefined, {
        ...(opts.hash ? { hash: opts.hash } : {}),
        ...(opts.push ? { push: true } : {}),
        ...(opts.prompt ? { prompt: true } : {}),
        ...(opts.clear ? { clear: true } : {}),
      }, flux);
    }),
  );
}

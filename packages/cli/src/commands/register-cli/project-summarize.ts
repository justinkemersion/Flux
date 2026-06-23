import { type Command } from "commander";
import { cmdProjectSummarize } from "../project-summarize";
import { cliActionWithFlux, HASH_FLAG_DESC } from "./shared";

export function registerProjectSummarizeCommands(program: Command): void {
  const projectCmd = program.commands.find((c) => c.name() === "project");
  if (!projectCmd) return;

  const summarizeCmd = projectCmd
    .command("summarize")
    .description("AI summary of project activity or resume context")
    .option("--hash <hex>", HASH_FLAG_DESC)
    .option(
      "--kind <kind>",
      'Summary type: "activity" (default) or "resume"',
      "activity",
    );

  summarizeCmd.action(
    cliActionWithFlux(async (flux) => {
      const opts = summarizeCmd.opts<{ hash?: string; kind?: string }>();
      await cmdProjectSummarize(undefined, {
        ...(opts.hash ? { hash: opts.hash } : {}),
        ...(opts.kind ? { kind: opts.kind } : {}),
      }, flux);
    }),
  );
}

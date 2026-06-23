import { type Command } from "commander";
import { cmdProjectBrief } from "../project-brief";
import { cliActionWithFlux, HASH_FLAG_DESC } from "./shared";

export function registerProjectBriefCommands(program: Command): void {
  const projectCmd = program.commands.find((c) => c.name() === "project");
  if (!projectCmd) return;

  const briefCmd = projectCmd
    .command("brief")
    .description("View or sync repo-root FLUX.md project brief");

  const generateCmd = briefCmd
    .command("generate")
    .description("Generate a FLUX.md draft with AI (requires host Workers AI)")
    .option("--hash <hex>", HASH_FLAG_DESC)
    .option("--save", "Save draft to dashboard snapshot");

  generateCmd.action(
    cliActionWithFlux(async (flux) => {
      const opts = generateCmd.opts<{ hash?: string; save?: boolean }>();
      await cmdProjectBrief(undefined, {
        ...(opts.hash ? { hash: opts.hash } : {}),
        generate: true,
        ...(opts.save ? { save: true } : {}),
      }, flux);
    }),
  );

  const pushCmd = briefCmd
    .command("push")
    .description("Upload local FLUX.md to the dashboard")
    .option("--hash <hex>", HASH_FLAG_DESC);

  pushCmd.action(
    cliActionWithFlux(async (flux) => {
      const opts = pushCmd.opts<{ hash?: string }>();
      await cmdProjectBrief(undefined, {
        ...(opts.hash ? { hash: opts.hash } : {}),
        push: true,
      }, flux);
    }),
  );

  const promptCmd = briefCmd
    .command("prompt")
    .description("Print a copyable generation prompt for Cursor/Codex")
    .option("--hash <hex>", HASH_FLAG_DESC);

  promptCmd.action(
    cliActionWithFlux(async (flux) => {
      const opts = promptCmd.opts<{ hash?: string }>();
      await cmdProjectBrief(undefined, {
        ...(opts.hash ? { hash: opts.hash } : {}),
        prompt: true,
      }, flux);
    }),
  );

  const clearCmd = briefCmd
    .command("clear")
    .description("Remove the dashboard snapshot (repo file unchanged)")
    .option("--hash <hex>", HASH_FLAG_DESC);

  clearCmd.action(
    cliActionWithFlux(async (flux) => {
      const opts = clearCmd.opts<{ hash?: string }>();
      await cmdProjectBrief(undefined, {
        ...(opts.hash ? { hash: opts.hash } : {}),
        clear: true,
      }, flux);
    }),
  );

  briefCmd
    .option("--hash <hex>", HASH_FLAG_DESC)
    .action(
      cliActionWithFlux(async (flux) => {
        const opts = briefCmd.opts<{ hash?: string }>();
        await cmdProjectBrief(undefined, {
          ...(opts.hash ? { hash: opts.hash } : {}),
        }, flux);
      }),
    );
}

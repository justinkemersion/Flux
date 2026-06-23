import { type Command } from "commander";
import { cmdProjectMetadata } from "../project-metadata";
import { cliActionWithFlux, HASH_FLAG_DESC } from "./shared";

export function registerProjectMetadataCommands(program: Command): void {
  const projectCmd = program.commands.find((c) => c.name() === "project");
  if (!projectCmd) return;

  const metadataCmd = projectCmd
    .command("metadata")
    .description("View or update project description and operator brief")
    .option("--hash <hex>", HASH_FLAG_DESC)
    .option("--description <text>", "Short purpose line (max 280 chars)")
    .option("--brief <text>", "Operator brief notes (max 8000 chars)")
    .option("--clear-description", "Remove the description")
    .option("--clear-brief", "Remove the brief");

  metadataCmd.action(
    cliActionWithFlux(async (flux) => {
      const opts = metadataCmd.opts<{
        hash?: string;
        description?: string;
        brief?: string;
        clearDescription?: boolean;
        clearBrief?: boolean;
      }>();
      await cmdProjectMetadata(undefined, {
        ...(opts.hash ? { hash: opts.hash } : {}),
        ...(opts.description !== undefined ? { description: opts.description } : {}),
        ...(opts.brief !== undefined ? { brief: opts.brief } : {}),
        ...(opts.clearDescription ? { clearDescription: true } : {}),
        ...(opts.clearBrief ? { clearBrief: true } : {}),
      }, flux);
    }),
  );
}

import { type Command } from "commander";
import { cmdDoctor } from "../doctor";
import { cliActionWithFlux, HASH_FLAG_DESC } from "./shared";

export function registerDoctorCommands(program: Command): void {
  const doctorCmd = program
    .command("doctor")
    .description(
      "Check project health: database, API, migration ledger, backup trust",
    )
    .argument("[name]", 'Project slug (default: "slug" in flux.json)')
    .option("--hash <hex>", HASH_FLAG_DESC);

  doctorCmd.action(
    cliActionWithFlux(async (flux, name: string | undefined) => {
      const opts = doctorCmd.opts<{ hash?: string }>();
      const doctorOpts = opts.hash ? { hash: opts.hash } : {};
      await cmdDoctor(name, doctorOpts, flux);
    }),
  );

  // Alias: `flux project doctor <name>`
  const projectCmd = program.commands.find((c) => c.name() === "project");
  if (projectCmd) {
    const subCmd = projectCmd
      .command("doctor")
      .description("Check project health (alias for flux doctor)")
      .argument("[name]", 'Project slug (default: "slug" in flux.json)')
      .option("--hash <hex>", HASH_FLAG_DESC);

    subCmd.action(
      cliActionWithFlux(async (flux, name: string | undefined) => {
        const opts = subCmd.opts<{ hash?: string }>();
        const doctorOpts = opts.hash ? { hash: opts.hash } : {};
        await cmdDoctor(name, doctorOpts, flux);
      }),
    );
  }
}

import { type Command } from "commander";
import { cmdProjectLifecycle } from "../project-lifecycle-state";
import { cliActionWithFlux, HASH_FLAG_DESC } from "./shared";

export function registerProjectLifecycleCommands(program: Command): void {
  const projectCmd = program.commands.find((c) => c.name() === "project");
  if (!projectCmd) return;

  const wakeCmd = projectCmd
    .command("wake")
    .description("Wake a dormant or archived project (resume API traffic)")
    .option("--hash <hex>", HASH_FLAG_DESC);

  wakeCmd.action(
    cliActionWithFlux(async (flux) => {
      const opts = wakeCmd.opts<{ hash?: string }>();
      await cmdProjectLifecycle("wake", {
        ...(opts.hash ? { hash: opts.hash } : {}),
      }, flux);
    }),
  );

  const sleepCmd = projectCmd
    .command("sleep")
    .description("Put an active project to sleep (pause API traffic; data retained)")
    .option("--hash <hex>", HASH_FLAG_DESC);

  sleepCmd.action(
    cliActionWithFlux(async (flux) => {
      const opts = sleepCmd.opts<{ hash?: string }>();
      await cmdProjectLifecycle("sleep", {
        ...(opts.hash ? { hash: opts.hash } : {}),
      }, flux);
    }),
  );

  const archiveCmd = projectCmd
    .command("archive")
    .description("Archive a project (long-term freeze; wake to resume)")
    .option("--hash <hex>", HASH_FLAG_DESC);

  archiveCmd.action(
    cliActionWithFlux(async (flux) => {
      const opts = archiveCmd.opts<{ hash?: string }>();
      await cmdProjectLifecycle("archive", {
        ...(opts.hash ? { hash: opts.hash } : {}),
      }, flux);
    }),
  );

  const lifecycleCmd = projectCmd
    .command("lifecycle")
    .description("Show project lifecycle state and active limits")
    .option("--hash <hex>", HASH_FLAG_DESC);

  lifecycleCmd.action(
    cliActionWithFlux(async (flux) => {
      const opts = lifecycleCmd.opts<{ hash?: string }>();
      await cmdProjectLifecycle(undefined, {
        ...(opts.hash ? { hash: opts.hash } : {}),
        show: true,
      }, flux);
    }),
  );
}

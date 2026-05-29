import chalk from "chalk";
import { type Command } from "commander";
import { cmdUpdate } from "../../cli-handlers";
import { cliAction } from "./shared";

export function registerAuthCommands(program: Command): void {
  program
    .command("update")
    .description("Print install commands to pull the latest CLI from the control plane")
    .action(cliAction(() => cmdUpdate()));

  const loginCmd = program
    .command("login")
    .description(
      "Authenticate with a Dashboard API key (stored in ~/.flux/config.json)",
    )
    .option(
      "--refresh",
      "Re-verify the saved token and refresh profile (no new API key)",
      false,
    )
    .action(
      cliAction(async () => {
        const { runFluxLogin } = await import("../login");
        const opts = loginCmd.opts<{ refresh?: boolean }>();
        await runFluxLogin({ refresh: opts.refresh === true });
      }),
    );

  program
    .command("whoami")
    .description("Show authenticated CLI user and operator/admin hint mode")
    .action(
      cliAction(async () => {
        const { loadConfig } = await import("../../config");
        const { resolveCliRole } = await import("../../utils/cli-audience");
        const cfg = loadConfig();
        if (!cfg?.token) {
          throw new Error("Not authenticated. Run `flux login`.");
        }
        const profile = cfg.profile;
        const user = profile?.user ?? "(unknown — run `flux login` again)";
        const role = resolveCliRole(profile);
        console.log(`User: ${user}`);
        console.log(`CLI role: ${role}`);
        if (role === "operator") {
          console.log(
            chalk.dim(
              "  Hints hidden. Admins: FLUX_CLI_ADMIN_EMAILS on control plane, or FLUX_CLI_VERBOSE=1 locally.",
            ),
          );
        }
      }),
    );
}

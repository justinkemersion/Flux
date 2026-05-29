import { type Command } from "commander";
import { cmdCors, cmdSupabaseRestPath } from "../../cli-handlers";
import { cliActionWithFlux, collectOriginOption, HASH_FLAG_DESC } from "./shared";

export function registerPostgrestConfigCommands(program: Command): void {
  const supabaseRestPathCmd = program
    .command("supabase-rest-path")
    .description("Enable or disable /rest/v1 path strip for the Supabase JS client on a project")
    .option(
      "-p, --project <name>",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option(
      "--off",
      "Disable strip (PostgREST at URL root on the gateway)",
      false,
    )
    .option("--hash <hex>", HASH_FLAG_DESC);

  supabaseRestPathCmd.action(
    cliActionWithFlux(async (flux) => {
      const opts = supabaseRestPathCmd.opts<{
        project?: string;
        off?: boolean;
        hash?: string;
      }>();
      await cmdSupabaseRestPath(
        opts.project ?? "",
        opts.off !== true,
        opts.hash,
        flux,
      );
    }),
  );

  const corsCmd = program
    .command("cors")
    .description("Manage per-project CORS allow-origins (extras; server may merge more)")
    .option(
      "-p, --project <name>",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option(
      "--add <origin>",
      "Origin to add. Repeatable.",
      collectOriginOption,
      [] as string[],
    )
    .option(
      "--remove <origin>",
      "Origin to remove. Repeatable.",
      collectOriginOption,
      [] as string[],
    )
    .option("--clear", "Remove all per-project CORS extras")
    .option("--list", "List current per-project CORS extras (default when no mutating flags)")
    .option("--hash <hex>", HASH_FLAG_DESC);

  corsCmd.action(
    cliActionWithFlux(async (flux) => {
      const opts = corsCmd.opts<{
        project?: string;
        add?: string[];
        remove?: string[];
        clear?: boolean;
        list?: boolean;
        hash?: string;
      }>();
      const actionOpts: Parameters<typeof cmdCors>[0] = {
        project: opts.project ?? "",
      };
      if (opts.add && opts.add.length > 0) actionOpts.add = opts.add;
      if (opts.remove && opts.remove.length > 0) actionOpts.remove = opts.remove;
      if (opts.clear) actionOpts.clear = true;
      if (opts.list) actionOpts.list = true;
      if (opts.hash) actionOpts.hash = opts.hash;
      await cmdCors(actionOpts, flux);
    }),
  );
}

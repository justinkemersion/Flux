import { type Command } from "commander";
import { cmdCreate } from "../create";
import { cmdInit } from "../init";
import { cmdProjectCredentials } from "../project-credentials";
import { resolveExplicitCreateMode } from "../../mode-default";
import { cliAction, cliActionWithFlux, HASH_FLAG_DESC } from "./shared";

export function registerInitCreateCommands(program: Command): void {
  const initCmd = program
    .command("init")
    .description(
      "Link or create a Flux project from repo-root flux.json (Foundry placeholder hash)",
    )
    .option("--slug <slug>", "Override slug from flux.json")
    .option(
      "--mode <mode>",
      "Optional. v1_dedicated or v2_shared. If omitted, the control plane picks from your plan.",
    )
    .option(
      "--yes",
      "Non-interactive (reserved; init does not prompt today)",
      false,
    )
    .option(
      "--no-supabase-rest-path",
      "Disable Supabase /rest/v1 path strip when creating a new project",
      false,
    )
    .action(
      cliAction(async () => {
        const opts = initCmd.opts<{
          slug?: string;
          mode?: string;
          yes?: boolean;
          noSupabaseRestPath?: boolean;
        }>();
        const mode = resolveExplicitCreateMode({
          explicitMode: opts.mode,
          envMode: process.env.FLUX_DEFAULT_MODE,
        });
        await cmdInit({
          ...(opts.slug ? { slug: opts.slug } : {}),
          ...(mode !== undefined ? { mode } : {}),
          ...(opts.yes === true ? { yes: true } : {}),
          ...(opts.noSupabaseRestPath === true
            ? { noSupabaseRestPath: true }
            : {}),
        });
      }),
    );

  const createCmd = program
    .command("create")
    .description("Create or repair a project through the control-plane API")
    .argument("<name>", "project name")
    .option(
      "--no-supabase-rest-path",
      "Disable Supabase /rest/v1 path strip (PostgREST at URL root)",
      false,
    )
    .option(
      "--hash <hex>",
      "Ignored for remote API (server allocates hash); reserved for local control plane",
    )
    .option(
      "--mode <mode>",
      "Optional. v1_dedicated or v2_shared. If omitted (and FLUX_DEFAULT_MODE unset), the control plane picks mode from your current plan.",
    )
    .action(
      cliAction(async (name: string) => {
        const opts = createCmd.opts<{
          noSupabaseRestPath?: boolean;
          hash?: string;
          mode?: string;
        }>();
        const mode = resolveExplicitCreateMode({
          explicitMode: opts.mode,
          envMode: process.env.FLUX_DEFAULT_MODE,
        });
        await cmdCreate(name, {
          noSupabaseRestPath: opts.noSupabaseRestPath === true,
          ...(opts.hash ? { hash: opts.hash } : {}),
          ...(mode !== undefined ? { mode } : {}),
        });
      }),
    );

  const projectRoot = program
    .command("project")
    .description("Project helpers backed by the control-plane API");

  const projectCredentialsCmd = projectRoot
    .command("credentials")
    .description(
      "Show FLUX_GATEWAY_JWT_SECRET (v2_shared) or Postgres + JWT keys (v1) for flux.json / hash",
    )
    .argument(
      "[name]",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option("--hash <hex>", HASH_FLAG_DESC);

  projectCredentialsCmd.action(
    cliActionWithFlux(async (flux, name: string | undefined) => {
      const opts = projectCredentialsCmd.opts<{ hash?: string }>();
      await cmdProjectCredentials(name, opts.hash, flux);
    }),
  );
}

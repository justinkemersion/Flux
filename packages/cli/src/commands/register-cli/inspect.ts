import { type Command } from "commander";
import { cmdDump, cmdList, cmdLogs, cmdOpen } from "../../cli-handlers";
import { cliAction, cliActionWithFlux, HASH_FLAG_DESC } from "./shared";

export function registerInspectCommands(program: Command): void {
  program
    .command("list")
    .description("List projects and API URLs (from the control plane when available)")
    .action(cliAction(() => cmdList()));

  const openCmd = program
    .command("open")
    .description(
      "Open the Dashboard Mesh Readout for a project in the default browser",
    )
    .argument(
      "[name]",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option(
      "-p, --project <name>",
      "Project slug (overrides positional if set)",
    )
    .option("--hash <hex>", HASH_FLAG_DESC);

  openCmd.action(
    cliActionWithFlux(async (flux, name: string | undefined) => {
      const opts = openCmd.opts<{ project?: string; hash?: string }>();
      await cmdOpen(name, opts.project, opts.hash, flux);
    }),
  );

  const logsCmd = program
    .command("logs")
    .description(
      "Stream tenant container logs from the control plane (live SSE, Docker follow)",
    )
    .argument(
      "[name]",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option(
      "-p, --project <name>",
      "Project slug (overrides positional if set)",
    )
    .option(
      "-s, --service <name>",
      "api (PostgREST) or db (Postgres)",
      "api",
    )
    .option("--hash <hex>", HASH_FLAG_DESC);

  logsCmd.action(
    cliActionWithFlux(async (flux, name: string | undefined) => {
      const opts = logsCmd.opts<{
        project?: string;
        service?: string;
        hash?: string;
      }>();
      const s = (opts.service ?? "api").trim().toLowerCase();
      if (s !== "api" && s !== "db") {
        throw new Error('--service must be "api" or "db"');
      }
      await cmdLogs(
        name,
        opts.project,
        s as "api" | "db",
        opts.hash,
        flux,
      );
    }),
  );

  const dumpCmd = program
    .command("dump")
    .description("Stream a project SQL dump to stdout (redirect to file)")
    .argument(
      "[name]",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option(
      "-p, --project <name>",
      "Project slug (overrides positional if set)",
    )
    .option("-s, --schema-only", "Schema only (pg_dump -s)", false)
    .option("-d, --data-only", "Data only (pg_dump -a)", false)
    .option("-c, --clean", "Include DROP statements (pg_dump -c --if-exists)", false)
    .option("--public-only", "Dump only public schema (pg_dump -n public)", false)
    .option("--hash <hex>", HASH_FLAG_DESC);

  dumpCmd.action(
    cliActionWithFlux(async (flux, name: string | undefined) => {
      const opts = dumpCmd.opts<{
        project?: string;
        schemaOnly?: boolean;
        dataOnly?: boolean;
        clean?: boolean;
        publicOnly?: boolean;
        hash?: string;
      }>();
      if (opts.schemaOnly === true && opts.dataOnly === true) {
        throw new Error("--schema-only and --data-only cannot be used together.");
      }
      await cmdDump(
        name,
        opts.project,
        opts.hash,
        {
          schemaOnly: opts.schemaOnly === true,
          dataOnly: opts.dataOnly === true,
          clean: opts.clean === true,
          publicOnly: opts.publicOnly === true,
        },
        flux,
      );
    }),
  );
}

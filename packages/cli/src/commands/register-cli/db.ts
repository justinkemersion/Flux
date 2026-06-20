import { type Command } from "commander";
import {
  cmdDbAccessPlan,
  cmdDbGuiConfig,
  cmdDbTunnel,
  type DbAccessCommonOptions,
} from "../../commands/db-access";
import { cliActionWithFlux, HASH_FLAG_DESC } from "./shared";

function collectDbAccessOptions(cmd: Command): DbAccessCommonOptions {
  const opts = cmd.opts<{
    project?: string;
    hash?: string;
    localPort?: string;
    host?: string;
    strictPort?: boolean;
    sshHost?: string;
    sshUser?: string;
    sshPort?: string;
    identityFile?: string;
    keepalive?: boolean;
    printConfig?: boolean;
    json?: boolean;
    verbose?: boolean;
  }>();
  const out: DbAccessCommonOptions = {};
  if (opts.project) out.project = opts.project;
  if (opts.hash) out.hash = opts.hash;
  if (opts.host) out.host = opts.host;
  if (opts.strictPort === true) out.strictPort = true;
  if (opts.sshHost) out.sshHost = opts.sshHost;
  if (opts.sshUser) out.sshUser = opts.sshUser;
  if (opts.identityFile) out.identityFile = opts.identityFile;
  if (opts.keepalive === true) out.keepalive = true;
  if (opts.printConfig === true) out.printConfig = true;
  if (opts.json === true) out.json = true;
  if (opts.verbose === true) out.verbose = true;
  if (opts.localPort) out.localPort = Number.parseInt(opts.localPort, 10);
  if (opts.sshPort) out.sshPort = Number.parseInt(opts.sshPort, 10);
  return out;
}

function registerDbAccessFlags(cmd: Command): void {
  cmd
    .argument("[name]", 'Project slug (default: "slug" in flux.json)')
    .option("-p, --project <name>", "Project slug (overrides positional if set)")
    .option("--hash <hex>", HASH_FLAG_DESC)
    .option("--local-port <port>", "Local bind port (default 15432)")
    .option("--strict-port", "Fail if requested local port is occupied", false)
    .option("--host <host>", "Local bind host (default 127.0.0.1)", "127.0.0.1")
    .option("--ssh-host <host>", "Override SSH host")
    .option("--ssh-user <user>", "Override SSH user")
    .option("--ssh-port <port>", "SSH port (default 22)")
    .option("--identity-file <path>", "SSH private key path")
    .option("--keepalive", "Enable SSH keepalive options", false)
    .option("--print-config", "Print GUI config without opening a tunnel", false)
    .option("--json", "Machine-readable output", false)
    .option("--verbose", "Show diagnostics (secrets still redacted)", false);
}

export function registerDbCommands(program: Command): void {
  const dbCmd = program
    .command("db")
    .description(
      "Private database access via SSH tunnels (Postgres stays off the public internet)",
    );

  const accessPlanCmd = dbCmd
    .command("access-plan")
    .description("Print the resolved mode-aware database access plan (redacted)");
  registerDbAccessFlags(accessPlanCmd);
  accessPlanCmd.action(
    cliActionWithFlux(async (flux, name: string | undefined) => {
      await cmdDbAccessPlan(name, collectDbAccessOptions(accessPlanCmd), flux);
    }),
  );

  const guiConfigCmd = dbCmd
    .command("gui-config")
    .description("Print copy-friendly GUI database connection settings");
  registerDbAccessFlags(guiConfigCmd);
  guiConfigCmd.action(
    cliActionWithFlux(async (flux, name: string | undefined) => {
      await cmdDbGuiConfig(name, collectDbAccessOptions(guiConfigCmd), flux);
    }),
  );

  const tunnelCmd = dbCmd
    .command("tunnel")
    .description("Open a local SSH tunnel to the project database (v1 dedicated in Pass 1)");
  registerDbAccessFlags(tunnelCmd);
  tunnelCmd.action(
    cliActionWithFlux(async (flux, name: string | undefined) => {
      await cmdDbTunnel(name, collectDbAccessOptions(tunnelCmd), flux);
    }),
  );
}

import { type Command } from "commander";
import {
  cmdDbAccessPlan,
  cmdDbDump,
  cmdDbGuiConfig,
  cmdDbPassword,
  cmdDbRestore,
  cmdDbShell,
  cmdDbTunnel,
  type DbAccessCommonOptions,
  type DbDumpOptions,
  type DbRestoreOptions,
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
    readonly?: boolean;
    readwrite?: boolean;
    ttl?: string;
    createTempCredentials?: boolean;
    command?: string;
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
  if (opts.readonly === true) out.readonly = true;
  if (opts.readwrite === true) out.readwrite = true;
  if (opts.createTempCredentials === true) out.createTempCredentials = true;
  if (opts.command) out.command = opts.command;
  if (opts.localPort) out.localPort = Number.parseInt(opts.localPort, 10);
  if (opts.sshPort) out.sshPort = Number.parseInt(opts.sshPort, 10);
  if (opts.ttl) out.ttl = Number.parseInt(opts.ttl, 10);
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
    .option("--readonly", "Request readonly temporary credentials (v2 default)", false)
    .option("--readwrite", "Request read/write temporary credentials (v2, platform policy)", false)
    .option("--ttl <seconds>", "Temporary credential lifetime (v2; default 1h ro / 30m rw)")
    .option(
      "--create-temp-credentials",
      "Create and print v2 temporary credentials with gui-config",
      false,
    )
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

  const passwordCmd = dbCmd
    .command("password")
    .description("Print the v1 dedicated Postgres password for GUI tools (paste-friendly)");
  registerDbAccessFlags(passwordCmd);
  passwordCmd.action(
    cliActionWithFlux(async (flux, name: string | undefined) => {
      await cmdDbPassword(name, collectDbAccessOptions(passwordCmd), flux);
    }),
  );

  const tunnelCmd = dbCmd
    .command("tunnel")
    .description("Open a local SSH tunnel to the project database");
  registerDbAccessFlags(tunnelCmd);
  tunnelCmd.action(
    cliActionWithFlux(async (flux, name: string | undefined) => {
      await cmdDbTunnel(name, collectDbAccessOptions(tunnelCmd), flux);
    }),
  );

  const shellCmd = dbCmd
    .command("shell")
    .description("Open psql through a temporary SSH tunnel");
  registerDbAccessFlags(shellCmd);
  shellCmd
    .option(
      "-c, --command <sql>",
      "Run a single SQL statement and exit (non-interactive)",
    )
    .action(
      cliActionWithFlux(async (flux, name: string | undefined) => {
        const opts = collectDbAccessOptions(shellCmd);
        const shellOpts = shellCmd.opts<{ command?: string }>();
        await cmdDbShell(
          name,
          {
            ...opts,
            ...(shellOpts.command ? { command: shellOpts.command } : {}),
          },
          flux,
        );
      }),
    );

  const dumpCmd = dbCmd
    .command("dump")
    .description("Write a schema-scoped pg_dump for v2_shared projects");
  registerDbAccessFlags(dumpCmd);
  dumpCmd
    .option("--output <path>", "Output dump path")
    .option(
      "--schema-only",
      "Dump schema definitions only (avoids RLS-blocked table data with temporary readonly roles)",
      false,
    )
    .action(
      cliActionWithFlux(async (flux, name: string | undefined) => {
        const opts = collectDbAccessOptions(dumpCmd);
        const dumpOpts = dumpCmd.opts<{ output?: string; schemaOnly?: boolean }>();
        await cmdDbDump(
          name,
          {
            ...opts,
            ...(dumpOpts.output ? { output: dumpOpts.output } : {}),
            ...(dumpOpts.schemaOnly === true ? { schemaOnly: true } : {}),
          },
          flux,
        );
      }),
    );

  const restoreCmd = dbCmd
    .command("restore")
    .description("Restore a v1 dedicated database dump (backup gate required)");
  registerDbAccessFlags(restoreCmd);
  restoreCmd
    .requiredOption("--input <path>", "pg_restore-compatible dump file")
    .option(
      "--skip-backup-check",
      "Override restore-verified backup requirement (dangerous)",
      false,
    )
    .option(
      "--yes-i-know-this-can-overwrite-data",
      "Acknowledge destructive restore",
      false,
    )
    .action(
      cliActionWithFlux(async (flux, name: string | undefined) => {
        const opts = collectDbAccessOptions(restoreCmd);
        const restoreOpts = restoreCmd.opts<{
          input?: string;
          skipBackupCheck?: boolean;
          yesIKnowThisCanOverwriteData?: boolean;
        }>();
        await cmdDbRestore(
          name,
          {
            ...opts,
            input: restoreOpts.input,
            skipBackupCheck: restoreOpts.skipBackupCheck === true,
            yesIKnowThisCanOverwriteData:
              restoreOpts.yesIKnowThisCanOverwriteData === true,
          },
          flux,
        );
      }),
    );
}

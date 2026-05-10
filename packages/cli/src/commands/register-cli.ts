import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { type Command } from "commander";
import { getApiClient } from "../api-client";
import {
  cmdBackupCreate,
  cmdBackupDownload,
  cmdBackupList,
  cmdBackupVerify,
  cmdCors,
  cmdDbReset,
  cmdDump,
  cmdEnvList,
  cmdEnvSet,
  cmdKeys,
  cmdList,
  cmdLogs,
  cmdNuke,
  cmdOpen,
  cmdReap,
  cmdStart,
  cmdStop,
  cmdSupabaseRestPath,
  cmdUpdate,
} from "../cli-handlers";
import { saveConfig } from "../config";
import { cmdCreate } from "./create";
import { cmdProjectCredentials } from "./project-credentials";
import { cmdPush } from "./push";
import { readFluxJson } from "../flux-config";
import { resolveExplicitCreateMode } from "../mode-default";
import {
  resolveHash,
  resolveOptionalName,
  resolveProjectSlug,
} from "../project-resolve";
import { printErrorAndExit } from "../output/cli-errors";

export function registerFluxCliCommands(program: Command): void {
  program
    .name("flux")
    .description(
      "Flux — control plane for tenant Postgres/PostgREST. Version: `flux -V` | `flux version`",
    );

  program
    .command("update")
    .description("Print install commands to pull the latest CLI from the control plane")
    .action(async () => {
      try {
        await cmdUpdate();
      } catch (e) {
        printErrorAndExit(e);
      }
    });

  program
    .command("login")
    .description("Authenticate with a Dashboard API key (stored in ~/.flux/config.json)")
    .action(async () => {
      try {
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const key = (
          await rl.question(
            "API key (Dashboard → Settings → API keys): ",
          )
        ).trim();
        await rl.close();
        if (!key) {
          throw new Error("No API key entered.");
        }
        const client = getApiClient();
        const { user, plan, defaultMode } = await client.verifyToken(key);
        saveConfig({ token: key, profile: { plan, defaultMode } });
        console.log(`Flux authenticated as ${user}.`);
        console.log(
          chalk.dim(
            `  Plan at login: ${plan} (typical default mode: ${defaultMode}). On create, omit --mode to let the control plane pick from your current plan; use --mode or FLUX_DEFAULT_MODE to override.`,
          ),
        );
      } catch (err: unknown) {
        printErrorAndExit(err);
      }
    });

  const hashFlagDesc =
    '7-hex project hash (overrides "hash" in flux.json)';

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
    .action(async (name: string) => {
      try {
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
    } catch (err: unknown) {
      printErrorAndExit(err);
    }
  });

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
    .option("--hash <hex>", hashFlagDesc);

  projectCredentialsCmd.action(async (name: string | undefined) => {
    try {
      const opts = projectCredentialsCmd.opts<{ hash?: string }>();
      const flux = await readFluxJson(process.cwd());
      await cmdProjectCredentials(name, opts.hash, flux);
    } catch (err: unknown) {
      printErrorAndExit(err);
    }
  });

  const push = program
    .command("push")
    .description("Apply a SQL file to a project (via control plane when available)")
    .argument("<file>", "path to .sql file")
    .option(
      "-p, --project <name>",
      "Project slug (default: \"slug\" in flux.json in CWD)",
    )
    .option(
      "-s, --supabase-compat",
      "Supabase mode: post-import migration and report (when API supports it)",
      false,
    )
    .option(
      "--no-sanitize",
      "Do not strip SET session lines for target Postgres (when API supports it)",
    )
    .option(
      "--disable-api-rls",
      "Disable RLS on api tables after import (when API supports it)",
      false,
    )
    .option("--hash <hex>", hashFlagDesc);

  push.action(async (file: string) => {
    try {
      const opts = push.opts<{
        project?: string;
        supabaseCompat: boolean;
        noSanitize?: boolean;
        disableApiRls?: boolean;
        hash?: string;
      }>();
      const flux = await readFluxJson(process.cwd());
      await cmdPush(
        file,
        opts.project ?? "",
        {
          supabaseCompat: opts.supabaseCompat,
          noSanitize: opts.noSanitize === true,
          disableApiRls: opts.disableApiRls === true,
          ...(opts.hash ? { hash: opts.hash } : {}),
        },
        flux,
      );
    } catch (err: unknown) {
      printErrorAndExit(err);
    }
  });

  const migrateCmd = program
    .command("migrate")
    .description(
      "Migrate a v2_shared (pooled) project to v1_dedicated via the control plane (downtime expected)",
    )
    .option(
      "-p, --project <slug>",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option("--to <mode>", "Target mode", "v1_dedicated")
    .option("--dry-run", "Show plan and preflight only", false)
    .option("-y, --yes", "Confirm destructive migration", false)
    .option(
      "--staged",
      "Provision dedicated DB and restore, but do not flip catalog mode yet",
      false,
    )
    .option(
      "--dump-only",
      "Only run pg_dump from the shared cluster to a temp file (no Docker changes)",
      false,
    )
    .option("--new-jwt-secret", "Rotate jwt_secret on switch", false)
    .option(
      "--no-lock-writes",
      "Do not enter gateway maintenance (migration_status)",
      false,
    )
    .option(
      "--drop-source-after",
      "After success, drop the tenant from the shared cluster (destructive)",
      false,
    )
    .option(
      "--skip-backup-check",
      "Skip requiring a restore-verified backup before migrate (dangerous)",
      false,
    )
    .option("--hash <hex>", hashFlagDesc);

  migrateCmd.action(async () => {
    try {
      const opts = migrateCmd.opts<{
        project?: string;
        to: string;
        dryRun: boolean;
        yes: boolean;
        staged: boolean;
        dumpOnly: boolean;
        newJwtSecret: boolean;
        noLockWrites: boolean;
        dropSourceAfter: boolean;
        skipBackupCheck: boolean;
        hash?: string;
      }>();
      if (opts.to !== "v1_dedicated") {
        throw new Error('Only --to v1_dedicated is supported today.');
      }
      const flux = await readFluxJson(process.cwd());
      const slug = resolveProjectSlug(
        opts.project ?? "",
        flux,
        "-p, --project",
      );
      const client = getApiClient();
      const hash = resolveHash(opts.hash, flux);
      const meta = await client.getProjectMetadata(hash);
      if (meta.slug !== slug) {
        throw new Error(
          `flux.json hash resolves to slug "${meta.slug}" but --project is "${slug}".`,
        );
      }
      if (meta.mode !== "v2_shared") {
        throw new Error(
          `flux migrate requires v2_shared; this project is ${meta.mode}.`,
        );
      }
      if (opts.skipBackupCheck !== true) {
        console.error(
          chalk.yellow(
            "Note: run `flux backup create && flux backup verify --latest` first for a portable tenant export (pg_dump -Fc --schema=t_<short>_api). Migrate also performs its own live pg_dump from the pooled cluster.",
          ),
        );
      }
      if (opts.staged && opts.newJwtSecret) {
        throw new Error(
          "--new-jwt-secret cannot be used with --staged (catalog jwt_secret would not match the new stack). Run a full migrate without --staged to rotate secrets.",
        );
      }
      const result = await client.migrateV2ToV1({
        slug,
        hash,
        dryRun: opts.dryRun,
        yes: opts.yes,
        staged: opts.staged,
        dumpOnly: opts.dumpOnly,
        newJwtSecret: opts.newJwtSecret,
        noLockWrites: opts.noLockWrites,
        dropSourceAfter: opts.dropSourceAfter,
        preserveJwtSecret: !opts.newJwtSecret,
        lockWrites: !opts.noLockWrites,
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (err: unknown) {
      printErrorAndExit(err);
    }
  });

  const dbReset = program
    .command("db-reset")
    .description(
      "Reset tenant DB: drop public and auth, reapply Flux bootstrap (irreversible data loss in those schemas)",
    )
    .option(
      "-p, --project <name>",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option("-y, --yes", "confirm", false)
    .option(
      "--skip-backup-check",
      "Allow reset even when the latest backup is not restore-verified (dangerous)",
      false,
    )
    .option("--hash <hex>", hashFlagDesc);

  dbReset.action(async () => {
    try {
      const opts = dbReset.opts<{
        project?: string;
        yes: boolean;
        skipBackupCheck: boolean;
        hash?: string;
      }>();
      const flux = await readFluxJson(process.cwd());
      await cmdDbReset(
        opts.project ?? "",
        opts.yes,
        opts.skipBackupCheck === true,
        opts.hash,
        flux,
      );
    } catch (err: unknown) {
      printErrorAndExit(err);
    }
  });

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
    .option("--hash <hex>", hashFlagDesc);

  supabaseRestPathCmd.action(async () => {
    try {
      const opts = supabaseRestPathCmd.opts<{
        project?: string;
        off?: boolean;
        hash?: string;
      }>();
      const flux = await readFluxJson(process.cwd());
      await cmdSupabaseRestPath(
        opts.project ?? "",
        opts.off !== true,
        opts.hash,
        flux,
      );
    } catch (err: unknown) {
      printErrorAndExit(err);
    }
  });

  const collectOriginOption = (value: string, prev: string[] = []): string[] => {
    const trimmed = value.trim();
    if (trimmed.length > 0) prev.push(trimmed);
    return prev;
  };

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
    .option("--hash <hex>", hashFlagDesc);

  corsCmd.action(async () => {
    try {
      const opts = corsCmd.opts<{
        project?: string;
        add?: string[];
        remove?: string[];
        clear?: boolean;
        list?: boolean;
        hash?: string;
      }>();
      const flux = await readFluxJson(process.cwd());
      const actionOpts: Parameters<typeof cmdCors>[0] = {
        project: opts.project ?? "",
      };
      if (opts.add && opts.add.length > 0) actionOpts.add = opts.add;
      if (opts.remove && opts.remove.length > 0) actionOpts.remove = opts.remove;
      if (opts.clear) actionOpts.clear = true;
      if (opts.list) actionOpts.list = true;
      if (opts.hash) actionOpts.hash = opts.hash;
      await cmdCors(actionOpts, flux);
    } catch (err: unknown) {
      printErrorAndExit(err);
    }
  });

  program
    .command("list")
    .description("List projects and API URLs (from the control plane when available)")
    .action(async () => {
      try {
        await cmdList();
      } catch (err: unknown) {
        printErrorAndExit(err);
      }
    });

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
    .option("--hash <hex>", hashFlagDesc);

  openCmd.action(async (name: string | undefined) => {
    try {
      const opts = openCmd.opts<{ project?: string; hash?: string }>();
      const flux = await readFluxJson(process.cwd());
      await cmdOpen(name, opts.project, opts.hash, flux);
    } catch (err: unknown) {
      printErrorAndExit(err);
    }
  });

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
    .option("--hash <hex>", hashFlagDesc);

  logsCmd.action(async (name: string | undefined) => {
    try {
      const opts = logsCmd.opts<{
        project?: string;
        service?: string;
        hash?: string;
      }>();
      const s = (opts.service ?? "api").trim().toLowerCase();
      if (s !== "api" && s !== "db") {
        throw new Error('--service must be "api" or "db"');
      }
      const flux = await readFluxJson(process.cwd());
      await cmdLogs(
        name,
        opts.project,
        s as "api" | "db",
        opts.hash,
        flux,
      );
    } catch (err: unknown) {
      printErrorAndExit(err);
    }
  });

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
    .option("--hash <hex>", hashFlagDesc);

  dumpCmd.action(async (name: string | undefined) => {
    try {
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
      const flux = await readFluxJson(process.cwd());
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
    } catch (err: unknown) {
      printErrorAndExit(err);
    }
  });

  const backupCmd = program
    .command("backup")
    .description("Create, list, and download project backups (v1 full DB or v2 tenant export)");

  const backupCreateCmd = backupCmd
    .command("create")
    .description("Create a new backup and store it in Flux backup storage")
    .argument(
      "[name]",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option(
      "-p, --project <name>",
      "Project slug (overrides positional if set)",
    )
    .option("--hash <hex>", hashFlagDesc);

  backupCreateCmd.action(async (name: string | undefined) => {
    try {
      const opts = backupCreateCmd.opts<{ project?: string; hash?: string }>();
      const flux = await readFluxJson(process.cwd());
      await cmdBackupCreate(name, opts.project, opts.hash, flux);
    } catch (err: unknown) {
      printErrorAndExit(err);
    }
  });

  const backupListCmd = backupCmd
    .command("list")
    .description("List project backups")
    .argument(
      "[name]",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option(
      "-p, --project <name>",
      "Project slug (overrides positional if set)",
    )
    .option("--hash <hex>", hashFlagDesc)
    .option(
      "--verbose",
      "Include reconcile timestamps / artifact paths + full-width columns per backup",
      false,
    );

  backupListCmd.action(async (name: string | undefined) => {
    try {
      const opts = backupListCmd.opts<{
        project?: string;
        hash?: string;
        verbose: boolean;
      }>();
      const flux = await readFluxJson(process.cwd());
      await cmdBackupList(
        name,
        opts.project,
        opts.hash,
        opts.verbose === true,
        flux,
      );
    } catch (err: unknown) {
      printErrorAndExit(err);
    }
  });

  const backupDownloadCmd = backupCmd
    .command("download")
    .description("Download backup artifact (pg_dump -Fc); use -o or shell redirect — not a terminal")
    .argument(
      "[name]",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option(
      "-p, --project <name>",
      "Project slug (overrides positional if set)",
    )
    .option("--id <backupId>", "Backup ID to download")
    .option("--latest", "Download newest backup", false)
    .option(
      "-o, --output <path>",
      "Write to file (recommended). Refuses to write binary to a TTY without this.",
    )
    .option("--hash <hex>", hashFlagDesc);

  backupDownloadCmd.action(async (name: string | undefined) => {
    try {
      const opts = backupDownloadCmd.opts<{
        project?: string;
        id?: string;
        latest?: boolean;
        output?: string;
        hash?: string;
      }>();
      const flux = await readFluxJson(process.cwd());
      await cmdBackupDownload(
        name,
        opts.project,
        opts.hash,
        opts.id,
        opts.latest === true,
        opts.output,
        flux,
      );
    } catch (err: unknown) {
      printErrorAndExit(err);
    }
  });

  const backupVerifyCmd = backupCmd
    .command("verify")
    .description("Run real restore verification for a backup using pg_restore")
    .argument(
      "[name]",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option(
      "-p, --project <name>",
      "Project slug (overrides positional if set)",
    )
    .option("--id <backupId>", "Backup ID to verify")
    .option("--latest", "Verify newest backup", false)
    .option("--hash <hex>", hashFlagDesc);

  backupVerifyCmd.action(async (name: string | undefined) => {
    try {
      const opts = backupVerifyCmd.opts<{
        project?: string;
        id?: string;
        latest?: boolean;
        hash?: string;
      }>();
      const flux = await readFluxJson(process.cwd());
      await cmdBackupVerify(
        name,
        opts.project,
        opts.hash,
        opts.id,
        opts.latest === true,
        flux,
      );
    } catch (err: unknown) {
      printErrorAndExit(err);
    }
  });

  const keysCmd = program
    .command("keys")
    .description("Print anon and service_role JWTs for a project (when API is available)")
    .argument(
      "[name]",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option("--hash <hex>", hashFlagDesc);

  keysCmd.action(async (name: string | undefined) => {
    try {
      const opts = keysCmd.opts<{ hash?: string }>();
      const flux = await readFluxJson(process.cwd());
      await cmdKeys(name, opts.hash, flux);
    } catch (err: unknown) {
      printErrorAndExit(err);
    }
  });

  const stopCmd = program
    .command("stop")
    .description("Stop Postgres and PostgREST for a project (when API is available)")
    .argument(
      "[name]",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option("--hash <hex>", hashFlagDesc);

  stopCmd.action(async (name: string | undefined) => {
    try {
      const opts = stopCmd.opts<{ hash?: string }>();
      const flux = await readFluxJson(process.cwd());
      await cmdStop(name, opts.hash, flux);
    } catch (err: unknown) {
      printErrorAndExit(err);
    }
  });

  const startCmd = program
    .command("start")
    .description("Start Postgres and PostgREST for a project (when API is available)")
    .argument(
      "[name]",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option("--hash <hex>", hashFlagDesc);

  startCmd.action(async (name: string | undefined) => {
    try {
      const opts = startCmd.opts<{ hash?: string }>();
      const flux = await readFluxJson(process.cwd());
      await cmdStart(name, opts.hash, flux);
    } catch (err: unknown) {
      printErrorAndExit(err);
    }
  });

  const nukeCmd = program
    .command("nuke")
    .description(
      "Atomic nuke: remove project catalog row, telemetry, and Docker stack (API + DB + data volume + net)",
    )
    .argument(
      "[name]",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option(
      "-y, --yes",
      "Skip slug confirmation prompt (without -y, you must type the exact project slug)",
      false,
    )
    .option(
      "--force",
      "No catalog row: still purge orphaned Docker resources for this slug+hash (same flux.json)",
      false,
    )
    .option(
      "--skip-backup-check",
      "Allow nuke even when the latest backup is not restore-verified (dangerous)",
      false,
    )
    .option("--hash <hex>", hashFlagDesc);

  nukeCmd.action(async (name: string | undefined) => {
    try {
      const opts = nukeCmd.opts<{
        yes: boolean;
        force?: boolean;
        skipBackupCheck: boolean;
        hash?: string;
      }>();
      const flux = await readFluxJson(process.cwd());
      await cmdNuke(
        name,
        opts.yes,
        opts.force === true,
        opts.skipBackupCheck === true,
        opts.hash,
        flux,
      );
    } catch (err: unknown) {
      printErrorAndExit(err);
    }
  });

  program
    .command("reap")
    .description("Stop idle projects past a threshold (control plane; flux-system not implied)")
    .requiredOption(
      "--hours <n>",
      "Idle threshold in hours (positive number)",
    )
    .action(async (opts: { hours: string }) => {
      try {
        const hours = Number(opts.hours);
        if (!Number.isFinite(hours) || hours <= 0) {
          throw new Error("--hours must be a positive number.");
        }
        await cmdReap(hours);
      } catch (err: unknown) {
        printErrorAndExit(err);
      }
    });

  const envRoot = program
    .command("env")
    .description("Read or update PostgREST (API) container environment (when API is available)");

  const envSet = envRoot
    .command("set")
    .description("Set KEY=value entries on the API container environment")
    .argument("<pairs...>", "one or more KEY=value entries")
    .option(
      "-p, --project <name>",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option("--hash <hex>", hashFlagDesc);

  envSet.action(async (pairs: string[]) => {
    try {
      const opts = envSet.opts<{ project?: string; hash?: string }>();
      const flux = await readFluxJson(process.cwd());
      await cmdEnvSet(opts.project ?? "", pairs, opts.hash, flux);
    } catch (err: unknown) {
      printErrorAndExit(err);
    }
  });

  const envList = envRoot
    .command("list")
    .description("List env keys on the API container (sensitive values hidden when applicable)")
    .option(
      "-p, --project <name>",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option("--hash <hex>", hashFlagDesc);

  envList.action(async () => {
    try {
      const opts = envList.opts<{ project?: string; hash?: string }>();
      const flux = await readFluxJson(process.cwd());
      await cmdEnvList(opts.project ?? "", opts.hash, flux);
    } catch (err: unknown) {
      printErrorAndExit(err);
    }
  });
}

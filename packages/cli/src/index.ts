import { access } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  FluxProjectEnvEntry,
  FluxProjectSummary,
  ImportSqlFileResult,
} from "@flux/core/standalone";
import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";
import { getApiClient } from "./api-client";
import { type FluxJson, readFluxJson } from "./flux-config";
import {
  resolveHash,
  resolveOptionalName,
  resolveProjectSlug,
} from "./project-resolve";

// Re-export SDK for bundling and programmatic use of PostgREST client types.
export {
  type FluxActivityOptions,
  type FluxClientOptions,
  createClient,
  FluxClient,
  type FluxResult,
  inferFluxTenantHashFromPostgrestUrl,
  inferFluxTenantSlugFromPostgrestUrl,
} from "@flux/sdk";

function isFluxDebug(): boolean {
  return process.env.FLUX_DEBUG != null && process.env.FLUX_DEBUG !== "" && process.env.FLUX_DEBUG !== "0";
}

function printBanner(title: string): void {
  console.log();
  console.log(chalk.bold.cyan(`  ${title}`));
  console.log(chalk.dim("  " + "─".repeat(Math.max(title.length, 24))));
}

function formatCliError(err: unknown): string {
  if (err instanceof Error) {
    if (isFluxDebug()) return err.stack ?? err.message;
    return err.message;
  }
  if (err !== null && typeof err === "object" && "message" in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === "string") return m;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function printErrorAndExit(err: unknown): void {
  console.error(chalk.red("Error:"), formatCliError(err));
  process.exit(1);
}

async function cmdCreate(
  name: string,
  options: { noSupabaseRestPath?: boolean; hash?: string },
): Promise<void> {
  const client = getApiClient();
  console.log(chalk.blue("Creating project…"));
  const spin = ora("Calling control plane…").start();
  try {
    const project = await client.createProject({
      name,
      stripSupabaseRestPrefix: options.noSupabaseRestPath !== true,
      ...(options.hash?.trim() ? { hash: options.hash.trim() } : {}),
    });
    spin.succeed("Provisioned");
    printBanner("Project ready");
    console.log(
      chalk.green("✓"),
      chalk.white("Created"),
      chalk.yellow(project.name),
      chalk.dim(`(${project.slug} · hash=${project.hash})`),
    );
    console.log();
    console.log(chalk.dim("  API"), chalk.white(project.apiUrl));
    if (project.postgresUrl) {
      console.log(chalk.dim("  Postgres"), chalk.white(project.postgresUrl));
    }
  } catch (e) {
    spin.fail("Failed");
    throw e;
  }
}

async function cmdPush(
  file: string,
  project: string,
  options: {
    supabaseCompat: boolean;
    noSanitize: boolean;
    disableApiRls: boolean;
    hash?: string;
  },
  flux: FluxJson | null,
): Promise<void> {
  const abs = resolve(process.cwd(), file);
  try {
    await access(abs);
  } catch {
    throw new Error(`SQL file not found or not accessible: ${abs}`);
  }

  const slug = resolveProjectSlug(project, flux, "-p, --project");
  const client = getApiClient();
  const hash = resolveHash(options.hash, flux);
  console.log(
    chalk.blue(
      `Applying ${chalk.bold(file)} to project ${chalk.bold(slug)}…`,
    ),
  );
  const spinner = ora("Applying SQL…").start();
  const emptyReport: ImportSqlFileResult = {
    tablesMoved: 0,
    sequencesMoved: 0,
    viewsMoved: 0,
  };
  let result: ImportSqlFileResult = emptyReport;
  try {
    if (options.supabaseCompat) {
      spinner.stop();
      console.log(
        chalk.dim("  Supabase compatibility mode. Adjusting schemas after import (when API is available)."),
      );
      if (options.disableApiRls) {
        console.log(
          chalk.dim("  Will disable RLS on api tables that have it when supported."),
        );
      }
      spinner.start("Applying…");
    }
    result = await client.importSqlFile(slug, abs, hash, {
      supabaseCompat: options.supabaseCompat,
      sanitizeForTarget: !options.noSanitize,
      moveFromPublic: options.supabaseCompat,
      ...(options.disableApiRls
        ? { disableRowLevelSecurityInApi: true as const }
        : {}),
    });
  } finally {
    spinner.stop();
  }
  console.log(chalk.green("✓"), chalk.white("SQL applied successfully."));
  if (options.supabaseCompat) {
    printBanner("Post-migration report");
    console.log(
      chalk.dim("  "),
      chalk.white("Tables moved to api:".padEnd(28)),
      chalk.cyan(String(result.tablesMoved)),
    );
    console.log(
      chalk.dim("  "),
      chalk.white("Sequences moved to api:".padEnd(28)),
      chalk.cyan(String(result.sequencesMoved)),
    );
    console.log(
      chalk.dim("  "),
      chalk.white("Views / matviews moved to api:".padEnd(28)),
      chalk.cyan(String(result.viewsMoved)),
    );
    console.log();
  }
}

async function cmdSupabaseRestPath(
  project: string,
  enable: boolean,
  cliHash: string | undefined,
  flux: FluxJson | null,
): Promise<void> {
  const slug = resolveProjectSlug(project, flux, "-p, --project");
  const client = getApiClient();
  const hash = resolveHash(cliHash, flux);
  console.log(
    chalk.blue(
      enable
        ? "Enabling /rest/v1 strip (Supabase client → PostgREST at /)…"
        : "Disabling /rest/v1 strip…",
    ),
  );
  await client.setPostgrestSupabaseRestPrefix(slug, enable, hash);
  console.log(
    chalk.green("✓"),
    chalk.white("PostgREST configuration update requested."),
  );
}

async function cmdCors(options: {
  project: string;
  hash?: string;
  add?: readonly string[];
  remove?: readonly string[];
  clear?: boolean;
  list?: boolean;
}, flux: FluxJson | null): Promise<void> {
  const project = resolveProjectSlug(options.project, flux, "-p, --project");
  const client = getApiClient();
  const hash = resolveHash(options.hash, flux);
  const add = options.add ?? [];
  const remove = options.remove ?? [];
  const clear = options.clear === true;

  const mutating = clear || add.length > 0 || remove.length > 0;

  if (mutating && clear && (add.length > 0 || remove.length > 0)) {
    throw new Error("flux cors: --clear cannot be combined with --add/--remove.");
  }

  if (!mutating) {
    const current = await client.getProjectAllowedOrigins(project, hash);
    if (current.length === 0) {
      console.log(
        chalk.dim(
          `No per-project CORS extras for "${project}". (When API is available, server defaults may still apply.)`,
        ),
      );
      return;
    }
    console.log(
      chalk.blue.bold(`Per-project CORS extras for "${project}":`),
    );
    for (const origin of current) console.log(`  ${origin}`);
    return;
  }

  let next: readonly string[];
  if (clear) {
    next = [];
  } else {
    const current = await client.getProjectAllowedOrigins(project, hash);
    const set = new Set<string>(current);
    for (const o of add) set.add(o.trim());
    for (const o of remove) set.delete(o.trim());
    set.delete("");
    next = Array.from(set);
  }

  console.log(
    chalk.blue(`Updating CORS for "${project}"…`),
  );
  await client.setProjectAllowedOrigins(project, next, hash);
  console.log(chalk.green("✓"), chalk.white("CORS allow-origins updated."));
  if (next.length === 0) {
    console.log(chalk.dim("  (All per-project CORS extras cleared.)"));
  } else {
    for (const origin of next) console.log(`  ${origin}`);
  }
}

async function cmdDbReset(
  project: string,
  yes: boolean,
  cliHash: string | undefined,
  flux: FluxJson | null,
): Promise<void> {
  if (!yes) {
    throw new Error(
      "Refusing db-reset: pass --yes to drop public and auth schemas and all data in them.",
    );
  }
  const slug = resolveProjectSlug(project, flux, "-p, --project");
  const client = getApiClient();
  const hash = resolveHash(cliHash, flux);
  console.log(
    chalk.blue(
      `Resetting database for ${chalk.bold(slug)} (drop public + auth, reapply Flux bootstrap)…`,
    ),
  );
  await client.resetTenantDatabaseForImport(slug, hash);
  console.log(
    chalk.green("✓"),
    chalk.white("Database reset. You can run"),
    chalk.cyan("flux push"),
    chalk.white("with a plain SQL file."),
  );
}

function statusCell(status: FluxProjectSummary["status"]): string {
  if (status === "running") {
    return chalk.green("Running".padEnd(10));
  }
  if (status === "stopped") {
    return chalk.yellow("Stopped".padEnd(10));
  }
  if (status === "partial") {
    return chalk.magenta("Partial".padEnd(10));
  }
  if (status === "missing") {
    return chalk.red("Missing".padEnd(10));
  }
  if (status === "corrupted") {
    return chalk.red("Drift".padEnd(10));
  }
  return chalk.dim(String(status).padEnd(10));
}

async function cmdReap(hours: number): Promise<void> {
  const client = getApiClient();
  console.log(
    chalk.blue(
      `Reaping projects idle longer than ${chalk.bold(String(hours))} hour(s)…`,
    ),
  );
  const { stopped, errors } = await client.reapIdleProjects(hours);
  if (stopped.length === 0 && errors.length === 0) {
    console.log(chalk.dim("  No projects past the threshold."));
    return;
  }
  for (const slug of stopped) {
    console.log(chalk.green("✓"), chalk.white("Stopped"), chalk.cyan(slug));
  }
  for (const e of errors) {
    console.log(chalk.red("✗"), chalk.cyan(e.slug), chalk.dim(e.message));
  }
  console.log();
}

async function cmdKeys(
  name: string | undefined,
  cliHash: string | undefined,
  flux: FluxJson | null,
): Promise<void> {
  const slug = resolveOptionalName(name, flux, "positional <name> argument");
  const client = getApiClient();
  const hash = resolveHash(cliHash, flux);
  const { anonKey, serviceRoleKey } = await client.getProjectKeys(slug, hash);

  printBanner(`JWT keys — ${slug}`);
  console.log();
  console.log(chalk.cyan("  Anon key"));
  console.log(chalk.white(`  ${anonKey}`));
  console.log();
  console.log(chalk.magenta("  Service role key"));
  console.log(chalk.white(`  ${serviceRoleKey}`));
  console.log();
  console.log(
    chalk.dim("  Keep the service role key secret; it bypasses RLS."),
  );
  console.log();
}

async function cmdList(): Promise<void> {
  const client = getApiClient();
  const rows = await client.listProjects();

  if (rows.length === 0) {
    console.log(chalk.dim("No projects returned."));
    return;
  }

  printBanner("Flux projects");
  const wProject = 26;
  const wHash = 10;
  const wStatus = 12;
  console.log(
    chalk.dim(
      `  ${"PROJECT".padEnd(wProject)}${"HASH".padEnd(wHash)}${"STATUS".padEnd(wStatus)}API URL`,
    ),
  );
  for (const r of rows) {
    console.log(
      `  ${chalk.cyan(r.slug.padEnd(wProject))}${chalk.yellow(r.hash.padEnd(wHash))}${statusCell(r.status)}${chalk.white(r.apiUrl)}`,
    );
  }
  console.log();
}

async function cmdStop(
  name: string | undefined,
  cliHash: string | undefined,
  flux: FluxJson | null,
): Promise<void> {
  const slug = resolveOptionalName(name, flux, "positional <name> argument");
  const client = getApiClient();
  const hash = resolveHash(cliHash, flux);
  console.log(chalk.blue(`Stopping project ${chalk.bold(slug)}…`));
  await client.stopProject(slug, hash);
  console.log(chalk.green("✓"), chalk.white("Stopped."));
}

async function cmdStart(
  name: string | undefined,
  cliHash: string | undefined,
  flux: FluxJson | null,
): Promise<void> {
  const slug = resolveOptionalName(name, flux, "positional <name> argument");
  const client = getApiClient();
  const hash = resolveHash(cliHash, flux);
  console.log(chalk.blue(`Starting project ${chalk.bold(slug)}…`));
  await client.startProject(slug, hash);
  console.log(chalk.green("✓"), chalk.white("Started."));
}

function parseEnvPairs(pairs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of pairs) {
    const i = raw.indexOf("=");
    if (i <= 0) {
      throw new Error(
        `Invalid "${raw}": expected KEY=value (quote values that contain spaces).`,
      );
    }
    const key = raw.slice(0, i).trim();
    if (!key) {
      throw new Error(`Invalid "${raw}": key cannot be empty.`);
    }
    out[key] = raw.slice(i + 1);
  }
  return out;
}

function formatEnvListRow(entry: FluxProjectEnvEntry): string {
  if (entry.sensitive) {
    return `${chalk.cyan(entry.key)} ${chalk.dim("(set)")}`;
  }
  return `${chalk.cyan(entry.key)}=${chalk.white(entry.value)}`;
}

async function cmdEnvSet(
  project: string,
  pairs: string[],
  cliHash: string | undefined,
  flux: FluxJson | null,
): Promise<void> {
  if (pairs.length === 0) {
    throw new Error("Provide at least one KEY=value pair.");
  }
  const envs = parseEnvPairs(pairs);
  const slug = resolveProjectSlug(project, flux, "-p, --project");
  const client = getApiClient();
  const hash = resolveHash(cliHash, flux);
  console.log(
    chalk.blue(
      `Updating API environment for project ${chalk.bold(slug)}…`,
    ),
  );
  await client.setProjectEnv(slug, envs, hash);
  console.log(chalk.green("✓"), chalk.white("Environment update requested."));
}

async function cmdEnvList(
  project: string,
  cliHash: string | undefined,
  flux: FluxJson | null,
): Promise<void> {
  const slug = resolveProjectSlug(project, flux, "-p, --project");
  const client = getApiClient();
  const hash = resolveHash(cliHash, flux);
  const rows = await client.listProjectEnv(slug, hash);
  if (rows.length === 0) {
    console.log(chalk.dim("No environment variables on the API container (or not yet available)."));
    return;
  }
  printBanner(`Environment — ${slug}`);
  for (const row of rows) {
    console.log(`  ${formatEnvListRow(row)}`);
  }
  console.log();
  console.log(
    chalk.dim("  Values for sensitive keys are not shown when marked (set)."),
  );
  console.log();
}

async function cmdNuke(
  name: string | undefined,
  yes: boolean,
  cliHash: string | undefined,
  flux: FluxJson | null,
): Promise<void> {
  if (!yes) {
    throw new Error("Refusing to nuke: pass --yes (-y) to delete all project data.");
  }
  const slug = resolveOptionalName(name, flux, "positional <name> argument");
  const client = getApiClient();
  const hash = resolveHash(cliHash, flux);
  console.log(
    chalk.red(
      `Nuking project ${chalk.bold(slug)} (removing containers and data volume when API is available)…`,
    ),
  );
  await client.nukeProject(slug, hash);
  console.log(chalk.green("✓"), chalk.white("Project removed."));
}

function fatalString(err: unknown): string {
  if (err instanceof Error) {
    if (isFluxDebug()) return err.stack ?? err.message;
    return err.message;
  }
  return String(err);
}

async function main(): Promise<void> {
  process.on("uncaughtException", (err: unknown) => {
    process.stderr.write(`\nFatal: ${fatalString(err)}\n`);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason: unknown) => {
    process.stderr.write(`\nFatal: ${fatalString(reason)}\n`);
    process.exit(1);
  });

  const program = new Command();

  program
    .name("flux")
    .description("Flux — manage projects and tenant APIs via the control plane")
    .version("1.0.0", "-V, --version");

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
      "Deterministic 7-hex hash for this project (server-dependent)",
    )
    .action(async (name: string) => {
      try {
        const opts = createCmd.opts<{
          noSupabaseRestPath?: boolean;
          hash?: string;
        }>();
        await cmdCreate(name, {
          noSupabaseRestPath: opts.noSupabaseRestPath === true,
          ...(opts.hash ? { hash: opts.hash } : {}),
        });
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
    .option("--hash <hex>", hashFlagDesc);

  dbReset.action(async () => {
    try {
      const opts = dbReset.opts<{
        project?: string;
        yes: boolean;
        hash?: string;
      }>();
      const flux = await readFluxJson(process.cwd());
      await cmdDbReset(opts.project ?? "", opts.yes, opts.hash, flux);
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
    .description("Remove a project and destroy its database volume (when API is available)")
    .argument(
      "[name]",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option(
      "-y, --yes",
      "Confirm irreversible deletion of all project data",
      false,
    )
    .option("--hash <hex>", hashFlagDesc);

  nukeCmd.action(async (name: string | undefined) => {
    try {
      const opts = nukeCmd.opts<{ yes: boolean; hash?: string }>();
      const flux = await readFluxJson(process.cwd());
      await cmdNuke(name, opts.yes, opts.hash, flux);
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

  await program.parseAsync(process.argv);
}

void main().catch((err: unknown) => {
  process.stderr.write(`${fatalString(err)}\n`);
  process.exit(1);
});

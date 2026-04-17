import { access } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  FluxProjectEnvEntry,
  FluxProjectSummary,
  ImportSqlFileResult,
} from "@flux/core";
import { ProjectManager } from "@flux/core";
import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";

function postgresConnectionUrl(
  hostPort: number,
  password: string,
): string {
  const user = encodeURIComponent("postgres");
  const pass = encodeURIComponent(password);
  return `postgresql://${user}:${pass}@localhost:${String(hostPort)}/postgres`;
}

function printBanner(title: string): void {
  console.log();
  console.log(chalk.bold.cyan(`  ${title}`));
  console.log(chalk.dim("  " + "─".repeat(Math.max(title.length, 24))));
}

function formatCliError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? err.message;
  }
  try {
    return JSON.stringify(err, null, 2);
  } catch {
    return String(err);
  }
}

async function cmdCreate(
  name: string,
  options: { noSupabaseRestPath?: boolean },
): Promise<void> {
  const pm = new ProjectManager();
  console.log(chalk.blue("Provisioning project…"));
  console.log(
    chalk.dim(
      "  (First run may pull Docker images and initialize Postgres — this can take a few minutes.)",
    ),
  );
  const project = await pm.provisionProject(name, {
    onStatus: (msg) => console.log(chalk.dim(`  ▸ ${msg}`)),
    ...(options.noSupabaseRestPath === true
      ? { stripSupabaseRestPrefix: false }
      : {}),
  });

  const pgPort = project.postgres.hostPort;
  if (pgPort == null) {
    throw new Error("Provision completed without a published Postgres host port.");
  }

  const pgUrl = postgresConnectionUrl(pgPort, project.postgresPassword);
  const { apiUrl } = project;

  printBanner("Project ready");
  console.log(
    chalk.green.bold("  ✓"),
    chalk.white("Created"),
    chalk.yellow(project.name),
    chalk.dim(`(${project.slug})`),
  );
  console.log();
  console.log(chalk.blue.bold("  Postgres"));
  console.log(chalk.dim("  "), chalk.white(pgUrl));
  console.log();
  console.log(chalk.blue.bold("  PostgREST"));
  console.log(chalk.dim("  "), chalk.white(apiUrl));
  if (project.stripSupabaseRestPrefix) {
    console.log(
      chalk.dim(
        "  Gateway: CORS http://localhost:3001 + strip /rest/v1 (Supabase client path).",
      ),
    );
  } else {
    console.log(
      chalk.dim(
        "  Gateway: CORS http://localhost:3001 only (no /rest/v1 strip).",
      ),
    );
  }
  console.log();
  console.log(
    chalk.dim("  Store the connection string securely; it includes credentials."),
  );
  console.log();
}

async function cmdPush(
  file: string,
  project: string,
  options: {
    supabaseCompat: boolean;
    noSanitize: boolean;
    disableApiRls: boolean;
  },
): Promise<void> {
  const abs = resolve(process.cwd(), file);
  try {
    await access(abs);
  } catch {
    console.error(chalk.red("SQL file not found or not accessible:"), abs);
    process.exitCode = 1;
    return;
  }

  const pm = new ProjectManager();
  console.log(
    chalk.blue(
      `Applying ${chalk.bold(file)} to project ${chalk.bold(project)}…`,
    ),
  );
  const spinner = ora("Streaming SQL into database…").start();
  if (options.supabaseCompat) {
    spinner.stop();
    console.log(
      chalk.dim("  ▸ Detected Supabase compatibility mode. Adjusting schemas…"),
    );
    if (options.disableApiRls) {
      console.log(
        chalk.dim(
          "  ▸ Will disable RLS on api tables that have it (Supabase policies often block Flux anon until rewritten).",
        ),
      );
    }
    spinner.start("Applying SQL and migrating schema…");
  }
  const emptyReport: ImportSqlFileResult = {
    tablesMoved: 0,
    sequencesMoved: 0,
    viewsMoved: 0,
  };
  let result: ImportSqlFileResult = emptyReport;
  try {
    result = await pm.importSqlFile(project, abs, {
      supabaseCompat: options.supabaseCompat,
      sanitizeForTarget: !options.noSanitize,
      moveFromPublic: options.supabaseCompat,
      ...(options.disableApiRls
        ? { disableRowLevelSecurityInApi: true }
        : {}),
    });
  } finally {
    spinner.stop();
  }
  console.log(chalk.green.bold("✓"), chalk.white("SQL applied successfully."));
  if (options.supabaseCompat) {
    printBanner("Post-migration report");
    console.log(
      chalk.dim("  "),
      chalk.white("Tables moved to api:".padEnd(28)),
      chalk.cyan.bold(String(result.tablesMoved)),
    );
    console.log(
      chalk.dim("  "),
      chalk.white("Sequences moved to api:".padEnd(28)),
      chalk.cyan.bold(String(result.sequencesMoved)),
    );
    console.log(
      chalk.dim("  "),
      chalk.white("Views / matviews moved to api:".padEnd(28)),
      chalk.cyan.bold(String(result.viewsMoved)),
    );
    console.log();
  }
}

async function cmdSupabaseRestPath(project: string, enable: boolean): Promise<void> {
  const pm = new ProjectManager();
  console.log(
    chalk.blue(
      enable
        ? "Enabling Traefik strip of /rest/v1 (Supabase JS client → PostgREST at /)…"
        : "Removing /rest/v1 strip (PostgREST served at gateway URL root only)…",
    ),
  );
  await pm.setPostgrestSupabaseRestPrefix(project, enable);
  console.log(
    chalk.green.bold("✓"),
    chalk.white(
      "PostgREST container recreated with updated labels. If the app still fails, confirm NEXT_PUBLIC_SUPABASE_URL is the project API URL (no /rest/v1 suffix) and keys match the dashboard.",
    ),
  );
}

async function cmdDbReset(project: string, yes: boolean): Promise<void> {
  if (!yes) {
    console.error(
      chalk.red.bold(
        "Refusing db-reset without confirmation: this drops public and auth schemas and all data in them.",
      ),
    );
    console.error(
      chalk.dim("Run with "),
      chalk.yellow("--yes"),
      chalk.dim(" to proceed."),
    );
    process.exit(1);
    return;
  }
  const pm = new ProjectManager();
  console.log(
    chalk.blue(
      `Resetting database for project ${chalk.bold(project)} (drop public + auth, reapply Flux bootstrap)…`,
    ),
  );
  await pm.resetTenantDatabaseForImport(project);
  console.log(
    chalk.green.bold("✓"),
    chalk.white("Database reset; you can run"),
    chalk.cyan("flux push"),
    chalk.white("with a plain SQL dump."),
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
    return chalk.redBright("Drift".padEnd(10));
  }
  return chalk.dim(String(status).padEnd(10));
}

async function cmdReap(hours: number): Promise<void> {
  const pm = new ProjectManager();
  console.log(
    chalk.blue(
      `Reaping tenant stacks idle longer than ${chalk.bold(String(hours))} hour(s) (catalog last_accessed_at; flux-system excluded)…`,
    ),
  );
  const { stopped, errors } = await pm.reapIdleProjects(hours);
  if (stopped.length === 0 && errors.length === 0) {
    console.log(chalk.dim("  No catalog rows past the idle threshold."));
    return;
  }
  for (const slug of stopped) {
    console.log(chalk.green.bold("  ✓"), chalk.white("Stopped"), chalk.cyan(slug));
  }
  for (const e of errors) {
    console.log(
      chalk.red.bold("  ✗"),
      chalk.cyan(e.slug),
      chalk.dim(e.message),
    );
  }
  console.log();
}

async function cmdList(): Promise<void> {
  const pm = new ProjectManager();
  const rows = await pm.listProjects();

  if (rows.length === 0) {
    console.log(
      chalk.dim(
        "No Flux projects found (expected containers named flux-<project>-db / flux-<project>-api).",
      ),
    );
    return;
  }

  printBanner("Flux projects");
  const wProject = 26;
  const wStatus = 12;
  console.log(
    chalk.dim(`  ${"PROJECT".padEnd(wProject)}${"STATUS".padEnd(wStatus)}API URL`),
  );
  for (const r of rows) {
    console.log(
      `  ${chalk.cyan.bold(r.slug.padEnd(wProject))}${statusCell(r.status)}${chalk.white(r.apiUrl)}`,
    );
  }
  console.log();
}

async function cmdStop(name: string): Promise<void> {
  const pm = new ProjectManager();
  console.log(chalk.blue(`Stopping project ${chalk.bold(name)}…`));
  await pm.stopProject(name);
  console.log(chalk.green.bold("✓"), chalk.white("Containers stopped."));
}

async function cmdStart(name: string): Promise<void> {
  const pm = new ProjectManager();
  console.log(chalk.blue(`Starting project ${chalk.bold(name)}…`));
  await pm.startProject(name);
  console.log(chalk.green.bold("✓"), chalk.white("Containers started."));
}

function parseEnvPairs(pairs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of pairs) {
    const i = raw.indexOf("=");
    if (i <= 0) {
      throw new Error(
        `Invalid "${raw}": expected KEY=value (use quotes if the value contains spaces).`,
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

async function cmdEnvSet(project: string, pairs: string[]): Promise<void> {
  if (pairs.length === 0) {
    throw new Error("Provide at least one KEY=value pair.");
  }
  const envs = parseEnvPairs(pairs);
  const pm = new ProjectManager();
  console.log(
    chalk.blue(
      `Updating API container environment for project ${chalk.bold(project)}…`,
    ),
  );
  await pm.setProjectEnv(project, envs);
  console.log(
    chalk.green.bold("✓"),
    chalk.white("Environment updated; PostgREST container was recreated."),
  );
}

async function cmdEnvList(project: string): Promise<void> {
  const pm = new ProjectManager();
  const rows = await pm.listProjectEnv(project);
  if (rows.length === 0) {
    console.log(chalk.dim("No environment variables on the API container."));
    return;
  }
  printBanner(`Environment — ${project}`);
  for (const row of rows) {
    console.log(`  ${formatEnvListRow(row)}`);
  }
  console.log();
  console.log(
    chalk.dim(
      "  Values for sensitive keys (secrets, tokens, DB URI, JWT) are not shown.",
    ),
  );
  console.log();
}

async function cmdNuke(name: string, yes: boolean): Promise<void> {
  if (!yes) {
    console.error(
      chalk.red.bold("Refusing to nuke without confirmation: this deletes all database data."),
    );
    console.error(
      chalk.dim("Run with "),
      chalk.yellow("--yes"),
      chalk.dim(" (or ") + chalk.yellow("-y") + chalk.dim(") to proceed."),
    );
    process.exit(1);
    return;
  }
  const pm = new ProjectManager();
  console.log(chalk.red.bold(`Nuking project ${name} — removing containers and volume…`));
  await pm.nukeProject(name, { acknowledgeDataLoss: true });
  console.log(
    chalk.green.bold("✓"),
    chalk.white("Project removed and data volume destroyed."),
  );
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("flux")
    .description(
      "Flux — provision projects, manage API env vars, and run SQL against tenant Postgres",
    )
    .version("1.0.0", "-V, --version");

  const createCmd = program
    .command("create")
    .description("Provision Postgres + PostgREST for a new project")
    .argument("<name>", "project name")
    .option(
      "--no-supabase-rest-path",
      "Omit flux-stripprefix on the tenant router (PostgREST at URL root; default is strip + CORS)",
      false,
    )
    .action(async (name: string) => {
      try {
        const opts = createCmd.opts<{ noSupabaseRestPath?: boolean }>();
        await cmdCreate(name, {
          noSupabaseRestPath: opts.noSupabaseRestPath === true,
        });
      } catch (err: unknown) {
        console.error(chalk.red.bold("Error"));
        console.error(formatCliError(err));
        process.exit(1);
      }
    });

  const push = program
    .command("push")
    .description(
      "Execute a SQL file against a project database (sanitizes pg_dump SET lines for the server version by default)",
    )
    .argument("<file>", "path to .sql file")
    .requiredOption("-p, --project <name>", "Flux project name")
    .option(
      "-s, --supabase-compat",
      "Supabase mode: auth stubs, move public → api after import, post-migration report",
      false,
    )
    .option(
      "--no-sanitize",
      "Do not strip SET session lines unsupported by the tenant Postgres major version",
    )
    .option(
      "--disable-api-rls",
      "After import: disable RLS on api tables that have it (typical Supabase port / local testing)",
      false,
    );

  push.action(async (file: string) => {
    try {
      const opts = push.opts<{
        project: string;
        supabaseCompat: boolean;
        noSanitize?: boolean;
        disableApiRls?: boolean;
      }>();
      await cmdPush(file, opts.project, {
        supabaseCompat: opts.supabaseCompat,
        noSanitize: opts.noSanitize === true,
        disableApiRls: opts.disableApiRls === true,
      });
    } catch (err: unknown) {
      console.error(chalk.red.bold("Error"));
      console.error(formatCliError(err));
      process.exit(1);
    }
  });

  const dbReset = program
    .command("db-reset")
    .description(
      "Drop public and auth schemas and reapply Flux bootstrap (for a clean import; irreversible data loss in those schemas)",
    )
    .requiredOption("-p, --project <name>", "Flux project name")
    .option("-y, --yes", "confirm", false);

  dbReset.action(async () => {
    try {
      const opts = dbReset.opts<{ project: string; yes: boolean }>();
      await cmdDbReset(opts.project, opts.yes);
    } catch (err: unknown) {
      console.error(chalk.red.bold("Error"));
      console.error(formatCliError(err));
      process.exit(1);
    }
  });

  const supabaseRestPathCmd = program
    .command("supabase-rest-path")
    .description(
      "Enable/disable Traefik strip of /rest/v1 for the Supabase JS client on an existing project",
    )
    .requiredOption("-p, --project <name>", "Flux project name")
    .option(
      "--off",
      "Remove the strip middleware instead of enabling it",
      false,
    );

  supabaseRestPathCmd.action(async () => {
    try {
      const opts = supabaseRestPathCmd.opts<{
        project: string;
        off?: boolean;
      }>();
      await cmdSupabaseRestPath(opts.project, opts.off !== true);
    } catch (err: unknown) {
      console.error(chalk.red.bold("Error"));
      console.error(formatCliError(err));
      process.exit(1);
    }
  });

  program
    .command("list")
    .description(
      "List Flux projects (containers flux-*-db / flux-*-api) and gateway API URLs",
    )
    .action(async () => {
      try {
        await cmdList();
      } catch (err: unknown) {
        console.error(chalk.red.bold("Error"));
        console.error(formatCliError(err));
        process.exit(1);
      }
    });

  program
    .command("stop")
    .description("Stop Postgres and PostgREST for a project")
    .argument("<name>", "project name")
    .action(async (name: string) => {
      try {
        await cmdStop(name);
      } catch (err: unknown) {
        console.error(chalk.red.bold("Error"));
        console.error(formatCliError(err));
        process.exit(1);
      }
    });

  program
    .command("start")
    .description("Start Postgres and PostgREST for a project")
    .argument("<name>", "project name")
    .action(async (name: string) => {
      try {
        await cmdStart(name);
      } catch (err: unknown) {
        console.error(chalk.red.bold("Error"));
        console.error(formatCliError(err));
        process.exit(1);
      }
    });

  program
    .command("nuke")
    .description(
      "Remove tenant containers and delete the Postgres volume (permanent data loss)",
    )
    .argument("<name>", "project name")
    .option("-y, --yes", "confirm irreversible deletion of all project data", false)
    .action(async (name: string, opts: { yes: boolean }) => {
      try {
        await cmdNuke(name, opts.yes);
      } catch (err: unknown) {
        console.error(chalk.red.bold("Error"));
        console.error(formatCliError(err));
        process.exit(1);
      }
    });

  program
    .command("reap")
    .description(
      "Stop Docker stacks for catalog projects with last_accessed_at older than the threshold (excludes flux-system)",
    )
    .requiredOption(
      "--hours <n>",
      "idle threshold in hours (must be a positive number)",
    )
    .action(async (opts: { hours: string }) => {
      try {
        const hours = Number(opts.hours);
        if (!Number.isFinite(hours) || hours <= 0) {
          throw new Error("--hours must be a positive number.");
        }
        await cmdReap(hours);
      } catch (err: unknown) {
        console.error(chalk.red.bold("Error"));
        console.error(formatCliError(err));
        process.exit(1);
      }
    });

  const envRoot = program
    .command("env")
    .description(
      "Read or update environment variables on the project PostgREST (API) container",
    );

  const envSet = envRoot
    .command("set")
    .description(
      "Merge KEY=value pairs into the API container env and recreate it so changes apply",
    )
    .argument("<pairs...>", "one or more KEY=value entries")
    .requiredOption("-p, --project <name>", "Flux project name");

  envSet.action(async (pairs: string[]) => {
    try {
      const opts = envSet.opts<{ project: string }>();
      await cmdEnvSet(opts.project, pairs);
    } catch (err: unknown) {
      console.error(chalk.red.bold("Error"));
      console.error(formatCliError(err));
      process.exit(1);
    }
  });

  const envList = envRoot
    .command("list")
    .description(
      "List env keys on the API container (values omitted for sensitive keys)",
    )
    .requiredOption("-p, --project <name>", "Flux project name");

  envList.action(async () => {
    try {
      const opts = envList.opts<{ project: string }>();
      await cmdEnvList(opts.project);
    } catch (err: unknown) {
      console.error(chalk.red.bold("Error"));
      console.error(formatCliError(err));
      process.exit(1);
    }
  });

  await program.parseAsync(process.argv);
}

void main().catch((err: unknown) => {
  console.error(chalk.red.bold("Fatal"));
  console.error(formatCliError(err));
  process.exit(1);
});

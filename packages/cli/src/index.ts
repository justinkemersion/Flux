import { access } from "node:fs/promises";
import { resolve } from "node:path";
import type { FluxProjectEnvEntry, FluxProjectSummary } from "@flux/core";
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

async function cmdCreate(name: string): Promise<void> {
  const pm = new ProjectManager();
  console.log(chalk.blue("Provisioning project…"));
  console.log(
    chalk.dim(
      "  (First run may pull Docker images and initialize Postgres — this can take a few minutes.)",
    ),
  );
  const project = await pm.provisionProject(name, {
    onStatus: (msg) => console.log(chalk.dim(`  ▸ ${msg}`)),
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
  try {
    await pm.importSqlFile(project, abs, {
      supabaseCompat: options.supabaseCompat,
      sanitizeForTarget: !options.noSanitize,
    });
  } finally {
    spinner.stop();
  }
  console.log(chalk.green.bold("✓"), chalk.white("SQL applied successfully."));
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
  return chalk.magenta("Partial".padEnd(10));
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

  program
    .command("create")
    .description("Provision Postgres + PostgREST for a new project")
    .argument("<name>", "project name")
    .action(async (name: string) => {
      try {
        await cmdCreate(name);
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
      "--supabase-compat",
      "Adapt Supabase-style dumps (auth schema, auth.uid, seed auth.users before FKs)",
      false,
    )
    .option(
      "--no-sanitize",
      "Do not strip SET session lines unsupported by the tenant Postgres major version",
    );

  push.action(async (file: string) => {
    try {
      const opts = push.opts<{
        project: string;
        supabaseCompat: boolean;
        noSanitize?: boolean;
      }>();
      await cmdPush(file, opts.project, {
        supabaseCompat: opts.supabaseCompat,
        noSanitize: opts.noSanitize === true,
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

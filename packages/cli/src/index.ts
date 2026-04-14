import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FluxProjectSummary } from "@flux/core";
import { ProjectManager } from "@flux/core";
import chalk from "chalk";
import { Command } from "commander";

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

async function cmdPush(file: string, project: string): Promise<void> {
  const abs = resolve(process.cwd(), file);
  let sql: string;
  try {
    sql = await readFile(abs, "utf8");
  } catch (err: unknown) {
    console.error(chalk.red("Could not read SQL file:"), abs);
    console.error(err);
    process.exitCode = 1;
    return;
  }

  const pm = new ProjectManager();
  console.log(chalk.blue(`Applying ${chalk.bold(file)} to project ${chalk.bold(project)}…`));
  await pm.executeSql(project, sql);
  console.log(chalk.green.bold("✓"), chalk.white("SQL executed successfully."));
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
    .description("Flux — provision projects and run SQL against tenant Postgres")
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
    .description("Execute a SQL file against a project database")
    .argument("<file>", "path to .sql file")
    .requiredOption("-p, --project <name>", "Flux project name");

  push.action(async (file: string) => {
    try {
      const opts = push.opts<{ project: string }>();
      await cmdPush(file, opts.project);
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

  await program.parseAsync(process.argv);
}

void main().catch((err: unknown) => {
  console.error(chalk.red.bold("Fatal"));
  console.error(formatCliError(err));
  process.exit(1);
});

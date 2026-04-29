#!/usr/bin/env node
import { access } from "node:fs/promises";
import { once } from "node:events";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import type {
  FluxProjectEnvEntry,
  FluxProjectSummary,
  ImportSqlFileResult,
} from "@flux/core/standalone";
import { fluxTenantDockerResourceNames } from "@flux/core/standalone";
import chalk from "chalk";
import { Command } from "commander";
import open from "open";
import ora from "ora";
import { getApiClient } from "./api-client";
import { cmdCreate } from "./commands/create";
import { cmdProjectCredentials } from "./commands/project-credentials";
import { saveConfig } from "./config";
import { type FluxJson, readFluxJson } from "./flux-config";
import { resolveExplicitCreateMode } from "./mode-default";
import {
  resolveHash,
  resolveOptionalName,
  resolveProjectSlug,
} from "./project-resolve";

/** Pinned in source; must match `packages/cli/package.json` and server `/api/install/cli/version` when published. */
const CLI_VERSION = "1.0.0";

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

const DEFAULT_API_BASE = "https://flux.vsl-base.com/api";

/**
 * Origin of the Next.js dashboard (Mesh Readout). Override with `FLUX_DASHBOARD_BASE`, or
 * derived from `FLUX_API_BASE` by stripping a trailing `/api` segment.
 */
function resolveDashboardBase(): string {
  const direct = process.env.FLUX_DASHBOARD_BASE?.trim();
  if (direct) {
    return direct.replace(/\/$/, "");
  }
  const raw = process.env.FLUX_API_BASE?.trim().replace(/\/$/, "");
  const api = raw && raw.length > 0 ? raw : DEFAULT_API_BASE;
  if (api.endsWith("/api")) {
    return api.slice(0, -"/api".length);
  }
  try {
    return new URL(api).origin;
  } catch {
    return "https://flux.vsl-base.com";
  }
}

/** Same origin as the dashboard; used for install bundle and version checks. */
const resolveInstallOrigin = resolveDashboardBase;

function isRemoteVersionNewer(remote: string, local: string): boolean {
  const pr = remote.split(/[.-]/u);
  const pl = local.split(/[.-]/u);
  const n = Math.max(pr.length, pl.length, 1);
  for (let i = 0; i < n; i++) {
    const a = parseInt(pr[i] ?? "0", 10);
    const b = parseInt(pl[i] ?? "0", 10);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

async function fetchRemoteCliVersion(): Promise<string | null> {
  const base = resolveInstallOrigin();
  const u = new URL(
    "/api/install/cli/version",
    base.endsWith("/") ? base : `${base}/`,
  );
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { version?: unknown };
    return typeof j.version === "string" ? j.version.trim() : null;
  } catch {
    return null;
  }
}

async function runVersionOutput(): Promise<void> {
  console.log(CLI_VERSION);
  const remote = await fetchRemoteCliVersion();
  if (remote && isRemoteVersionNewer(remote, CLI_VERSION)) {
    console.log(
      chalk.dim(`Update available: ${remote} (current ${CLI_VERSION})`),
    );
  }
}

async function cmdUpdate(): Promise<void> {
  const origin = resolveInstallOrigin();
  const bundle = new URL(
    "/api/install/cli",
    origin.endsWith("/") ? origin : `${origin}/`,
  ).href;
  const v = await fetchRemoteCliVersion();
  console.log(
    chalk.dim("flux update — pull latest bundle, then run with node (Node 20+):"),
  );
  console.log();
  console.log(
    `  curl -fsSL ${bundle} -o /tmp/flux.mjs && node /tmp/flux.mjs --help`,
  );
  console.log();
  console.log(chalk.dim("Or copy to a dir on PATH:"));
  console.log(
    `  curl -fsSL ${bundle} -o flux && chmod +x flux && mv flux ~/.local/bin/`,
  );
  if (v) {
    console.log();
    console.log(chalk.dim(`Control plane version: ${v}`));
  }
}

async function cmdOpen(
  name: string | undefined,
  projectOpt: string | undefined,
  cliHash: string | undefined,
  flux: FluxJson | null,
): Promise<void> {
  const fromCli = projectOpt?.trim() || name;
  const slug = resolveProjectSlug(
    fromCli,
    flux,
    "positional <name> or -p, --project",
  );
  resolveHash(cliHash, flux);
  const base = resolveDashboardBase();
  const url = new URL(
    `/projects/${encodeURIComponent(slug)}`,
    base,
  ).href;
  console.log(`Opening Mesh Readout for ${slug}...`);
  await open(url);
}

function formatLogLineForTerminal(
  line: string,
  service: "api" | "db",
): string {
  const label = service === "api" ? "api" : "db";
  const head = chalk.bold(`[${label}]`);
  const m = line.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(.*)$/s,
  );
  if (m) {
    return `${head} ${chalk.dim(m[1]!)} ${m[2]!}`;
  }
  return `${head} ${line}`;
}

async function cmdLogs(
  name: string | undefined,
  projectOpt: string | undefined,
  service: "api" | "db",
  hash: string | undefined,
  flux: FluxJson | null,
): Promise<void> {
  const fromCli = projectOpt?.trim() || name;
  const slug = resolveProjectSlug(
    fromCli,
    flux,
    "positional [name] or -p, --project",
  );
  const h = resolveHash(hash, flux);
  const client = getApiClient();
  const ac = new AbortController();
  const onSig = (): void => {
    ac.abort();
  };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);
  try {
    try {
      await client.streamContainerLogs(
        { slug, hash: h, service },
        (ev) => {
          if (ev.line != null) {
            console.log(formatLogLineForTerminal(ev.line, service));
          }
        },
        { signal: ac.signal },
      );
    } catch (e: unknown) {
      if (
        e instanceof Error &&
        (e.name === "AbortError" ||
          /aborted|The operation was aborted/i.test(e.message))
      ) {
        return;
      }
      throw e;
    }
  } finally {
    process.off("SIGINT", onSig);
    process.off("SIGTERM", onSig);
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
        chalk.dim(
          "  Supabase compatibility mode. Remote control plane applies the raw SQL as-is; local transforms are not run.",
        ),
      );
      if (options.disableApiRls) {
        console.log(
          chalk.dim("  (RLS options are not applied on remote push yet.)"),
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
  const metadata = await client.getProjectMetadata(hash);
  if (metadata.mode === "v2_shared") {
    throw new Error(
      "This project uses pooled mode (v2_shared) and does not expose static anon/service keys. Use user auth tokens instead.",
    );
  }
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

async function cmdDump(
  name: string | undefined,
  projectOpt: string | undefined,
  cliHash: string | undefined,
  opts: {
    schemaOnly?: boolean;
    dataOnly?: boolean;
    clean?: boolean;
    publicOnly?: boolean;
  },
  flux: FluxJson | null,
): Promise<void> {
  const fromCli = projectOpt?.trim() || name;
  const slug = resolveOptionalName(
    fromCli,
    flux,
    "positional [name] or -p, --project",
  );
  const hash = resolveHash(cliHash, flux);
  process.stderr.write(`Dumping data for ${slug} (${hash})...\n`);
  const client = getApiClient();
  const webStream = await client.getProjectDumpStream({
    hash,
    schemaOnly: opts.schemaOnly === true,
    dataOnly: opts.dataOnly === true,
    clean: opts.clean === true,
    publicOnly: opts.publicOnly === true,
  });
  const nodeStream = Readable.fromWeb(
    webStream as import("node:stream/web").ReadableStream,
  );
  for await (const chunk of nodeStream) {
    if (!process.stdout.write(chunk)) {
      await once(process.stdout, "drain");
    }
  }
  process.stderr.write("Dump complete.\n");
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
  forceOrphan: boolean,
  cliHash: string | undefined,
  flux: FluxJson | null,
): Promise<void> {
  const slug = resolveOptionalName(name, flux, "positional <name> argument");
  const hash = resolveHash(cliHash, flux);
  if (!yes) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      const line = (
        await rl.question(
          `Type the project slug "${slug}" to confirm purge: `,
        )
      ).trim();
      if (line !== slug) {
        throw new Error("Aborted: slug did not match; no changes made.");
      }
    } finally {
      await rl.close();
    }
  }
  const client = getApiClient();
  const names = fluxTenantDockerResourceNames(slug, hash);
  for (const r of [names.api, names.db, names.volume, names.network] as const) {
    console.log(`PURGING: ${r}`);
  }
  await client.nukeProject(slug, hash, { forceOrphan: forceOrphan });
  console.log(
    `Cleanup Complete: ${hash} infrastructure erased.`,
  );
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

  const argv = process.argv.slice(2);
  if (
    argv.length === 1 &&
    (argv[0] === "-V" || argv[0] === "--version" || argv[0] === "version")
  ) {
    try {
      await runVersionOutput();
    } catch (e) {
      printErrorAndExit(e);
    }
    return;
  }

  const program = new Command();

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
            `Plan at login: ${plan} (typical default mode: ${defaultMode}). On create, omit --mode to let the control plane pick from your current plan; use --mode or FLUX_DEFAULT_MODE to override.`,
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
    .option("--hash <hex>", hashFlagDesc);

  nukeCmd.action(async (name: string | undefined) => {
    try {
      const opts = nukeCmd.opts<{
        yes: boolean;
        force?: boolean;
        hash?: string;
      }>();
      const flux = await readFluxJson(process.cwd());
      await cmdNuke(
        name,
        opts.yes,
        opts.force === true,
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

  await program.parseAsync(process.argv);
}

void main().catch((err: unknown) => {
  process.stderr.write(`${fatalString(err)}\n`);
  process.exit(1);
});

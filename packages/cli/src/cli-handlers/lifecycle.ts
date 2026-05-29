import { once } from "node:events";
import { createInterface } from "node:readline/promises";
import { Readable } from "node:stream";
import type { FluxProjectSummary } from "@flux/core/standalone";
import { fluxTenantDockerResourceNames } from "@flux/core/standalone";
import chalk from "chalk";
import { getApiClient } from "../api-client";
import { sectionBanner } from "../cli-layout";
import type { FluxJson } from "../flux-config";
import { resolveHash, resolveOptionalName } from "../project-resolve";
import { ensureRestoreVerifiedLatestBackup } from "./backup-gate";

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

export async function cmdReap(hours: number): Promise<void> {
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

export async function cmdKeys(
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

  sectionBanner(`JWT keys — ${slug}`);
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

export async function cmdDump(
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

export async function cmdList(): Promise<void> {
  const client = getApiClient();
  const rows = await client.listProjects();

  if (rows.length === 0) {
    console.log(chalk.dim("No projects returned."));
    return;
  }

  sectionBanner("Flux projects");
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

export async function cmdStop(
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

export async function cmdStart(
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

export async function cmdNuke(
  name: string | undefined,
  yes: boolean,
  forceOrphan: boolean,
  skipBackupCheck: boolean,
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
  if (!forceOrphan) {
    await ensureRestoreVerifiedLatestBackup(client, hash, skipBackupCheck);
  }
  const names = fluxTenantDockerResourceNames(slug, hash);
  for (const r of [names.api, names.db, names.volume, names.network] as const) {
    console.log(`PURGING: ${r}`);
  }
  await client.nukeProject(slug, hash, {
    forceOrphan: forceOrphan,
    skipBackupCheck: skipBackupCheck,
  });
  console.log(
    `Cleanup Complete: ${hash} infrastructure erased.`,
  );
}

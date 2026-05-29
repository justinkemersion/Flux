import type { FluxProjectEnvEntry } from "@flux/core/standalone";
import chalk from "chalk";
import { getApiClient } from "../api-client";
import { sectionBanner } from "../cli-layout";
import type { FluxJson } from "../flux-config";
import { resolveHash, resolveProjectSlug } from "../project-resolve";

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

export async function cmdEnvSet(
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

export async function cmdEnvList(
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
  sectionBanner(`Environment — ${slug}`);
  for (const row of rows) {
    console.log(`  ${formatEnvListRow(row)}`);
  }
  console.log();
  console.log(
    chalk.dim("  Values for sensitive keys are not shown when marked (set)."),
  );
  console.log();
}

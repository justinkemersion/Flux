import { slugifyProjectName } from "@flux/core/standalone";
import chalk from "chalk";
import ora from "ora";
import type { CreateProjectMode, InitProjectResult } from "../api-client";
import { getApiClient } from "../api-client";
import { resolveFluxApiToken } from "../config";
import {
  isFluxInitPlaceholderHash,
  readFluxJsonRaw,
  writeFluxJson,
} from "../flux-config";
import { resolveExplicitCreateMode } from "../mode-default";

export type CmdInitOptions = {
  slug?: string;
  mode?: CreateProjectMode;
  noSupabaseRestPath?: boolean;
  yes?: boolean;
};

export function requireInitAuth(token?: string | null): void {
  const resolved = token === undefined ? resolveFluxApiToken() : token;
  if (!resolved?.trim()) {
    throw new Error("Not authenticated. Run `flux login`.");
  }
}

export const FLUX_INIT_NEXT_STEPS = [
  "pnpm flux:schema:sync",
  "flux push sql/migrations/ --plan",
  "flux push sql/migrations/ --dry-run",
  "flux push sql/migrations/",
] as const;

function printInitSuccess(result: InitProjectResult): void {
  const linkedNote =
    result.action === "linked"
      ? chalk.dim(" (linked existing project)")
      : "";
  console.log();
  console.log(chalk.bold("Initialized Flux project") + linkedNote);
  console.log();
  console.log(`  ${chalk.dim("Slug:")} ${result.slug}`);
  console.log(`  ${chalk.dim("Hash:")} ${result.hash}`);
  console.log(`  ${chalk.dim("Mode:")} ${result.mode}`);
  console.log(`  ${chalk.dim("API:")} ${result.apiUrl}`);
  console.log();
  console.log(chalk.dim("Next:"));
  for (const line of FLUX_INIT_NEXT_STEPS) {
    console.log(`  ${line}`);
  }
  console.log();
  console.log(
    chalk.dim(
      "  Gateway JWT: run `flux project credentials` or use the dashboard (not written to flux.json).",
    ),
  );
  console.log();
}

function printAlreadyInitialized(
  result: InitProjectResult,
  apiUrl?: string,
): void {
  console.log();
  console.log(chalk.bold("flux.json already initialized."));
  console.log();
  console.log(`  ${chalk.dim("Slug:")} ${result.slug}`);
  console.log(`  ${chalk.dim("Hash:")} ${result.hash}`);
  console.log(`  ${chalk.dim("Mode:")} ${result.mode}`);
  if (apiUrl) {
    console.log(`  ${chalk.dim("API:")} ${apiUrl}`);
  }
  if (result.apiSchema) {
    console.log(`  ${chalk.dim("Schema:")} ${result.apiSchema}`);
  }
  console.log();
}

export async function cmdInit(options: CmdInitOptions): Promise<void> {
  void options.yes;

  requireInitAuth();

  const cwd = process.cwd();
  const flux = await readFluxJsonRaw(cwd);
  if (!flux) {
    throw new Error(
      "No flux.json found. Run this command from a Flux app directory.",
    );
  }

  const slugInput = options.slug?.trim() || flux.slug;
  let slug: string;
  try {
    slug = slugifyProjectName(slugInput);
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Invalid project slug.",
    );
  }

  const client = getApiClient();
  const hash = flux.hash;

  if (!isFluxInitPlaceholderHash(hash)) {
    const meta = await client.getProjectMetadata(hash);
    const remoteSlug = slugifyProjectName(meta.slug);
    if (remoteSlug !== slug) {
      throw new Error(
        `flux.json slug "${slug}" does not match control plane slug "${remoteSlug}" for hash ${hash}.`,
      );
    }
    let apiUrl: string | undefined;
    try {
      const listed = await client.listProjects();
      apiUrl = listed.find((p) => p.hash === hash)?.apiUrl;
    } catch {
      apiUrl = undefined;
    }
    printAlreadyInitialized(
      {
        action: "linked",
        slug: remoteSlug,
        hash: meta.hash,
        mode: meta.mode,
        apiUrl: apiUrl ?? "",
        apiSchema: meta.apiSchema ?? "",
      },
      apiUrl,
    );
    return;
  }

  const mode = resolveExplicitCreateMode({
    explicitMode: options.mode,
    envMode: process.env.FLUX_DEFAULT_MODE,
  });

  const spin = ora("POST /api/cli/v1/init…").start();
  let result: InitProjectResult;
  try {
    result = await client.initProject({
      slug,
      ...(mode !== undefined ? { mode } : {}),
      ...(options.noSupabaseRestPath === true
        ? { stripSupabaseRestPrefix: false }
        : {}),
    });
    spin.succeed(result.action === "linked" ? "Linked" : "Created");
  } catch (e) {
    spin.fail("Failed");
    throw e;
  }

  await writeFluxJson(cwd, {
    slug: result.slug,
    hash: result.hash,
    apiUrl: result.apiUrl,
    mode: result.mode,
    apiSchema: result.apiSchema,
  });

  printInitSuccess(result);
}

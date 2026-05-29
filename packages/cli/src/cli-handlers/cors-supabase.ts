import chalk from "chalk";
import { getApiClient } from "../api-client";
import type { FluxJson } from "../flux-config";
import { resolveHash, resolveProjectSlug } from "../project-resolve";

export async function cmdSupabaseRestPath(
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

export async function cmdCors(options: {
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

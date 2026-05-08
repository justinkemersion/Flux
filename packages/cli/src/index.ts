#!/usr/bin/env node
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { createInterface } from "node:readline/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  FluxProjectEnvEntry,
  FluxProjectSummary,
} from "@flux/core/standalone";
import {
  backupTrustTierLabel,
  BACKUP_TRUST_REMEDIATION_CLI,
  classifyNewestBackup,
  destructiveBackupCheckMessage,
} from "@flux/core/backup-trust";
import { fluxTenantDockerResourceNames } from "@flux/core/standalone";
import chalk from "chalk";
import { Command } from "commander";
import open from "open";
import { getApiClient } from "./api-client";
import { sectionBanner } from "./cli-layout";
import { cmdCreate } from "./commands/create";
import { cmdProjectCredentials } from "./commands/project-credentials";
import { cmdPush } from "./commands/push";
import { saveConfig } from "./config";
import { resolveDashboardBase } from "./dashboard-base";
import { type FluxJson, readFluxJson } from "./flux-config";
import { resolveExplicitCreateMode } from "./mode-default";
import {
  resolveHash,
  resolveOptionalName,
  resolveProjectSlug,
} from "./project-resolve";
import { hydrateProcessEnvFromProjectFiles } from "./utils/env-file";

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
    `  curl -fsSL ${bundle} -o /tmp/flux.cjs && node /tmp/flux.cjs --help`,
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

async function ensureRestoreVerifiedLatestBackup(
  client: ReturnType<typeof getApiClient>,
  hash: string,
  skipBackupCheck: boolean,
): Promise<void> {
  if (skipBackupCheck) return;
  const meta = await client.getProjectMetadata(hash);
  if (meta.mode !== "v1_dedicated") return;
  const { backups } = await client.listProjectBackups(hash);
  const c = classifyNewestBackup(backups);
  if (!c.allowsDestructiveWithoutOverride) {
    throw new Error(destructiveBackupCheckMessage(c));
  }
}

function printBackupTrustSummary(classification: ReturnType<typeof classifyNewestBackup>): void {
  const label = backupTrustTierLabel(classification.tier);
  if (classification.tier === "restorable") {
    console.log(
      chalk.green("✓") +
        chalk.white(" Latest backup is ") +
        chalk.green.bold("restorable") +
        chalk.white(" (") +
        chalk.dim("restore_verified") +
        chalk.white(")."),
    );
    console.log(chalk.dim("  This project has a verified restorable backup."));
    return;
  }
  if (classification.tier === "restore_failed") {
    console.log(
      chalk.red("✗"),
      chalk.white.bold(label),
      chalk.dim(` — ${classification.detail}`),
    );
  } else if (classification.tier === "not_restore_verified") {
    console.log(
      chalk.yellow("⚠"),
      chalk.white.bold(label),
      chalk.dim(` — ${classification.detail}`),
    );
  } else if (classification.tier === "artifact_pending") {
    console.log(
      chalk.blue("⋯"),
      chalk.white.bold(label),
      chalk.dim(` — ${classification.detail}`),
    );
    console.log(
      chalk.dim("  Try listing backups again shortly if catalog validation has not caught up."),
    );
    return;
  } else {
    console.log(
      chalk.yellow("⚠"),
      chalk.white(label + "."),
      chalk.dim(` ${classification.detail}`),
    );
  }
  console.log(chalk.dim(`  Next: ${BACKUP_TRUST_REMEDIATION_CLI}`));
}

async function cmdDbReset(
  project: string,
  yes: boolean,
  skipBackupCheck: boolean,
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
  await ensureRestoreVerifiedLatestBackup(client, hash, skipBackupCheck);
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

function fmtBytes(n: number | null | undefined): string {
  if (!Number.isFinite(n ?? NaN) || (n ?? 0) < 0) return "-";
  const v = Number(n);
  if (v < 1024) return `${String(v)} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KiB`;
  if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(v / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

/** Trim long `<projectId>/<backupId>.dump` for verbose table cells. */
function fmtArtifactRelPath(p: string | undefined): string {
  const s = (p ?? "").trim() || "-";
  if (s.length <= 44) return s.padEnd(44);
  return `${s.slice(0, 18)}…${s.slice(-23)}`;
}

async function cmdBackupCreate(
  name: string | undefined,
  projectOpt: string | undefined,
  cliHash: string | undefined,
  flux: FluxJson | null,
): Promise<void> {
  const fromCli = projectOpt?.trim() || name;
  const slug = resolveOptionalName(fromCli, flux, "positional [name] or -p, --project");
  const hash = resolveHash(cliHash, flux);
  const client = getApiClient();
  console.log(chalk.blue(`Creating backup for ${chalk.bold(slug)}...`));
  const backup = await client.createProjectBackup(hash);
  console.log(chalk.green("✓"), chalk.white("Backup complete."));
  console.log(
    chalk.dim(
      `  id=${backup.id} status=${backup.status} size=${fmtBytes(backup.sizeBytes ?? null)}`,
    ),
  );
}

async function cmdBackupList(
  name: string | undefined,
  projectOpt: string | undefined,
  cliHash: string | undefined,
  verbose: boolean,
  flux: FluxJson | null,
): Promise<void> {
  const fromCli = projectOpt?.trim() || name;
  resolveOptionalName(fromCli, flux, "positional [name] or -p, --project");
  const hash = resolveHash(cliHash, flux);
  const client = getApiClient();
  const { backups, reconciledAt, backupVolumeAbsoluteRoot } =
    await client.listProjectBackups(hash);
  sectionBanner("Backups");
  const classification = classifyNewestBackup(backups);
  printBackupTrustSummary(classification);
  if (verbose) {
    if (reconciledAt) {
      console.log(
        chalk.dim(`  Checked artifacts on server at ${reconciledAt}.`),
      );
    }
    if (backupVolumeAbsoluteRoot) {
      console.log(
        chalk.dim(`  Backup volume root on API server: ${backupVolumeAbsoluteRoot}`),
      );
    }
    if (backups[0]?.primaryArtifactAbsolutePath) {
      console.log(
        chalk.dim(`  Newest artifact (absolute on API server): ${backups[0].primaryArtifactAbsolutePath}`),
      );
    }
    if (backups[0]?.primaryArtifactRelativePath) {
      console.log(
        chalk.dim(`  Relative to volume root: ${backups[0].primaryArtifactRelativePath}`),
      );
    }
    console.log(
      chalk.dim(
        "  Host ls at the volume path can be empty when flux-web uses a Docker named volume — dumps live inside the volume; use docker exec against flux-web or bind-mount for host-visible files.",
      ),
    );
  }
  console.log();
  if (backups.length === 0) {
    console.log(chalk.dim("  No backup rows yet."));
    return;
  }
  if (verbose) {
    console.log(
      chalk.dim(
        "  ID                                   STATUS     SIZE       CREATED                    VALIDATION        RESTORE_VERIFY   ARTIFACT_REL_PATH",
      ),
    );
    for (const row of backups) {
      console.log(
        `  ${chalk.cyan(row.id.padEnd(36))} ${String(row.status).padEnd(10)} ${fmtBytes(row.sizeBytes ?? null).padEnd(10)} ${(row.createdAt ?? "-").padEnd(25)} ${String(row.artifactValidationStatus ?? "pending").padEnd(17)} ${String(row.restoreVerificationStatus ?? "pending").padEnd(16)} ${fmtArtifactRelPath(row.primaryArtifactRelativePath)}`,
      );
    }
    return;
  }
  console.log(
    chalk.dim(
      "  History (newest first) — use --verbose for reconcile/paths detail + full technical columns",
    ),
  );
  console.log(chalk.dim("  ID                                   CREATED                    TRUST"));
  for (let i = 0; i < backups.length; i++) {
    const row = backups[i]!;
    const rowTrust = classifyNewestBackup([row]);
    const trustShort = backupTrustTierLabel(rowTrust.tier);
    const line = `  ${row.id.padEnd(36)} ${(row.createdAt ?? "-").padEnd(25)} ${trustShort}`;
    console.log(i === 0 ? line : chalk.dim(line));
  }
}

async function cmdBackupDownload(
  name: string | undefined,
  projectOpt: string | undefined,
  cliHash: string | undefined,
  backupId: string | undefined,
  latest: boolean,
  outputPath: string | undefined,
  flux: FluxJson | null,
): Promise<void> {
  const fromCli = projectOpt?.trim() || name;
  const slug = resolveOptionalName(fromCli, flux, "positional [name] or -p, --project");
  const hash = resolveHash(cliHash, flux);
  const client = getApiClient();
  let targetId = (backupId ?? "").trim();
  if (latest) {
    const { backups: rows } = await client.listProjectBackups(hash);
    if (rows.length === 0) {
      throw new Error("No backups available to download.");
    }
    targetId = rows[0]!.id;
  }
  if (!targetId) {
    throw new Error("Provide --id <backupId> or --latest.");
  }
  const out = outputPath?.trim();
  if (!out && process.stdout.isTTY) {
    throw new Error(
      "Refusing to write a binary pg_dump archive to a terminal. Use:\n" +
        `  flux backup download -p ${slug} --hash ${hash} --id ${targetId} -o ./backup.dump\n` +
        "or redirect: flux backup download ... > backup.dump",
    );
  }
  process.stderr.write(`Downloading backup ${targetId} for ${slug} (${hash})...\n`);
  const webStream = await client.getProjectBackupStream({ hash, backupId: targetId });
  const nodeStream = Readable.fromWeb(
    webStream as import("node:stream/web").ReadableStream,
  );
  if (out) {
    await pipeline(nodeStream, createWriteStream(out));
  } else {
    for await (const chunk of nodeStream) {
      if (!process.stdout.write(chunk)) {
        await once(process.stdout, "drain");
      }
    }
  }
  process.stderr.write("Download complete.\n");
}

async function cmdBackupVerify(
  name: string | undefined,
  projectOpt: string | undefined,
  cliHash: string | undefined,
  backupId: string | undefined,
  latest: boolean,
  flux: FluxJson | null,
): Promise<void> {
  const fromCli = projectOpt?.trim() || name;
  const slug = resolveOptionalName(fromCli, flux, "positional [name] or -p, --project");
  const hash = resolveHash(cliHash, flux);
  const client = getApiClient();
  let id = (backupId ?? "").trim();
  if (latest) {
    const { backups: rows } = await client.listProjectBackups(hash);
    if (rows.length === 0) {
      throw new Error("No backups available to verify.");
    }
    id = rows[0]!.id;
  }
  if (!id) throw new Error("Provide --id <backupId> or --latest.");
  console.log(chalk.blue(`Verifying restore for backup ${chalk.bold(id)} on ${chalk.bold(slug)}...`));
  const result = await client.verifyProjectBackup({ hash, backupId: id });
  console.log(chalk.green("✓"), chalk.white(`Restore verification: ${result.restoreVerificationStatus}`));
}

async function cmdList(): Promise<void> {
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

async function cmdNuke(
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
  // Orphan purge has no catalog row; backups API is unavailable.
  if (!forceOrphan) {
    await ensureRestoreVerifiedLatestBackup(client, hash, skipBackupCheck);
  }
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

  await hydrateProcessEnvFromProjectFiles(process.cwd());

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
      "Skip the notice that v2_shared has no flux backup verify loop (v1 dedicated only)",
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
            "Note: flux backup create / verify applies to v1_dedicated only; migrate uses a live pg_dump from the pooled cluster. Ensure you are comfortable with this path before proceeding.",
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
      "Allow reset even when the latest v1 backup is not restore-verified (dangerous)",
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
    .description("Create, list, and download dedicated project backups");

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
      "Allow nuke even when the latest v1 backup is not restore-verified (dangerous)",
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

  await program.parseAsync(process.argv);
}

void main().catch((err: unknown) => {
  process.stderr.write(`${fatalString(err)}\n`);
  process.exit(1);
});

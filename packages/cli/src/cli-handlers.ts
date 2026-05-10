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
  backupTrustTierLabelForKind,
  BACKUP_TRUST_REMEDIATION_CLI,
  classifyNewestBackup,
  destructiveBackupCheckMessage,
} from "@flux/core/backup-trust";
import { fluxTenantDockerResourceNames } from "@flux/core/standalone";
import chalk from "chalk";
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
import { isFluxDebug, printErrorAndExit } from "./output/cli-errors";

/** Pinned in source; must match `packages/cli/package.json` and server `/api/install/cli/version` when published. */
const CLI_VERSION = "1.0.0";

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

export async function runVersionOutput(): Promise<void> {
  console.log(CLI_VERSION);
  const remote = await fetchRemoteCliVersion();
  if (remote && isRemoteVersionNewer(remote, CLI_VERSION)) {
    console.log(
      chalk.dim(`Update available: ${remote} (current ${CLI_VERSION})`),
    );
  }
}
export async function cmdUpdate(): Promise<void> {
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

export async function cmdOpen(
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

export async function cmdLogs(
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

async function ensureRestoreVerifiedLatestBackup(
  client: ReturnType<typeof getApiClient>,
  hash: string,
  skipBackupCheck: boolean,
): Promise<void> {
  if (skipBackupCheck) return;
  await client.getProjectMetadata(hash);
  const { backups } = await client.listProjectBackups(hash);
  const c = classifyNewestBackup(backups);
  if (!c.allowsDestructiveWithoutOverride) {
    throw new Error(destructiveBackupCheckMessage(c));
  }
}

function printBackupTrustSummary(
  classification: ReturnType<typeof classifyNewestBackup>,
  kind?: "project_db" | "tenant_export" | null,
): void {
  const k = kind ?? "project_db";
  const label = backupTrustTierLabelForKind(k, classification.tier);
  if (classification.tier === "restorable") {
    console.log(
      chalk.green("✓") +
        chalk.white(" ") +
        chalk.green.bold(label) +
        chalk.white(" (") +
        chalk.dim("restore_verified") +
        chalk.white(")."),
    );
    console.log(
      chalk.dim(
        k === "tenant_export"
          ? "  This project has a verified restorable tenant export."
          : "  This project has a verified restorable backup.",
      ),
    );
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

export async function cmdDbReset(
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

export async function cmdBackupCreate(
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
      `  id=${backup.id} kind=${backup.kind ?? "project_db"} status=${backup.status} size=${fmtBytes(backup.sizeBytes ?? null)}`,
    ),
  );
}

export async function cmdBackupList(
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
  printBackupTrustSummary(classification, backups[0]?.kind);
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
        "  ID                                   KIND       STATUS     SIZE       CREATED                    VALIDATION        RESTORE_VERIFY   ARTIFACT_REL_PATH",
      ),
    );
    for (const row of backups) {
      const kindCell = (row.kind ?? "project_db").padEnd(10);
      console.log(
        `  ${chalk.cyan(row.id.padEnd(36))} ${kindCell} ${String(row.status).padEnd(10)} ${fmtBytes(row.sizeBytes ?? null).padEnd(10)} ${(row.createdAt ?? "-").padEnd(25)} ${String(row.artifactValidationStatus ?? "pending").padEnd(17)} ${String(row.restoreVerificationStatus ?? "pending").padEnd(16)} ${fmtArtifactRelPath(row.primaryArtifactRelativePath)}`,
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
    const trustShort = backupTrustTierLabelForKind(row.kind ?? "project_db", rowTrust.tier);
    const line = `  ${row.id.padEnd(36)} ${(row.createdAt ?? "-").padEnd(25)} ${trustShort}`;
    console.log(i === 0 ? line : chalk.dim(line));
  }
}

export async function cmdBackupDownload(
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

export async function cmdBackupVerify(
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

export function fatalString(err: unknown): string {
  if (err instanceof Error) {
    if (isFluxDebug()) return err.stack ?? err.message;
    return err.message;
  }
  return String(err);
}

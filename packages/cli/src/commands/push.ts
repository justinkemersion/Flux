import { createHmac } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { LEGACY_FLUX_API_SCHEMA } from "@flux/core";
import {
  listMigrationSqlFiles,
  loadLocalMigrations,
  migrationConflictMessage,
  planMigrations,
  type FluxMigrationRecord,
  type MigrationPushMeta,
} from "@flux/core/sql-migrations";
import type { ImportSqlFileResult } from "@flux/core/standalone";
import chalk from "chalk";
import ora from "ora";
import { getApiClient } from "../api-client";
import { sectionBanner } from "../cli-layout";
import { resolveDashboardBase } from "../dashboard-base";
import type { FluxJson } from "../flux-config";
import { resolveHash, resolveProjectSlug } from "../project-resolve";
import { readEnvFile } from "../utils/env-file";

const MAX_SQL_BYTES = 4 * 1024 * 1024;

export type CmdPushOptions = {
  supabaseCompat: boolean;
  noSanitize: boolean;
  disableApiRls: boolean;
  hash?: string;
};

export type PushTarget =
  | { kind: "file"; path: string }
  | { kind: "directory"; path: string };

const DEFAULT_PUSH_CANDIDATES = [
  "migrations",
  "flux/migrations",
  "sql",
  "schema.sql",
] as const;

/**
 * Resolves push target from an explicit argument or default discovery order.
 */
export async function resolvePushTarget(arg?: string): Promise<PushTarget> {
  if (arg?.trim()) {
    const abs = resolve(process.cwd(), arg.trim());
    return classifyPushPath(abs);
  }
  for (const rel of DEFAULT_PUSH_CANDIDATES) {
    const abs = resolve(process.cwd(), rel);
    try {
      await access(abs);
      return classifyPushPath(abs);
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    "No push target found. Pass a .sql file or migrations directory, or add one of: migrations/, flux/migrations/, sql/, schema.sql",
  );
}

async function classifyPushPath(abs: string): Promise<PushTarget> {
  const st = await stat(abs);
  if (st.isDirectory()) {
    return { kind: "directory", path: abs };
  }
  if (st.isFile()) {
    return { kind: "file", path: abs };
  }
  throw new Error(`Push target is not a file or directory: ${abs}`);
}

export async function cmdPush(
  targetArg: string | undefined,
  project: string,
  options: CmdPushOptions,
  flux: FluxJson | null,
): Promise<void> {
  const target = await resolvePushTarget(targetArg);
  const slug = resolveProjectSlug(project, flux, "-p, --project");
  const hash = resolveHash(options.hash, flux);
  const client = getApiClient();
  const metadata = await client.getProjectMetadata(hash);

  if (target.kind === "directory") {
    if (metadata.mode === "v2_shared") {
      if (options.supabaseCompat || options.disableApiRls) {
        console.log(
          chalk.dim(
            "  --supabase-compat / --disable-api-rls have no effect on pooled (v2_shared) projects; ignoring.",
          ),
        );
      }
    } else if (options.supabaseCompat) {
      console.log(
        chalk.dim(
          "  --supabase-compat is ignored for directory migrations (use single-file push for Supabase import mode).",
        ),
      );
    }
    await cmdPushMigrationsDir({
      dir: target.path,
      slug,
      hash,
      mode: metadata.mode,
      schemaHint:
        metadata.mode === "v1_dedicated"
          ? `${metadata.mode}, schema ${metadata.apiSchema ?? LEGACY_FLUX_API_SCHEMA}`
          : metadata.mode,
      options,
    });
    return;
  }

  const file = target.path;
  const schemaHint =
    metadata.mode === "v1_dedicated"
      ? `${metadata.mode}, schema ${metadata.apiSchema ?? LEGACY_FLUX_API_SCHEMA}`
      : metadata.mode;
  console.log(
    chalk.blue(
      `Applying ${chalk.bold(file)} to project ${chalk.bold(slug)} (${chalk.dim(schemaHint)})…`,
    ),
  );

  if (metadata.mode === "v2_shared") {
    if (options.supabaseCompat || options.disableApiRls) {
      console.log(
        chalk.dim(
          "  --supabase-compat / --disable-api-rls have no effect on pooled (v2_shared) projects; ignoring.",
        ),
      );
    }
    await pushSqlV2({ slug, hash, sqlPath: file });
    console.log(chalk.green("✓"), chalk.white("SQL applied successfully."));
    return;
  }

  await pushSqlV1({
    slug,
    hash,
    sqlPath: file,
    options,
  });
}

async function cmdPushMigrationsDir(input: {
  dir: string;
  slug: string;
  hash: string;
  mode: string;
  schemaHint: string;
  options: CmdPushOptions;
}): Promise<void> {
  sectionBanner("Flux migrations");
  console.log(
    chalk.dim(
      `Project ${chalk.bold(input.slug)} (${input.schemaHint}) · ${input.dir}`,
    ),
  );
  console.log();

  const paths = await listMigrationSqlFiles(input.dir);
  const local = await loadLocalMigrations(paths);
  const applied = await fetchAppliedMigrations({
    slug: input.slug,
    hash: input.hash,
    mode: input.mode,
  });
  const plan = planMigrations(local, applied);

  for (const { file, appliedChecksum } of plan.conflicts) {
    throw new Error(migrationConflictMessage(file, appliedChecksum));
  }

  let appliedCount = 0;
  let skippedCount = 0;

  for (const file of plan.skip) {
    console.log(
      chalk.green("✓"),
      chalk.white(`${file.filename} already applied`),
    );
    skippedCount += 1;
  }

  for (const file of plan.apply) {
    console.log(
      chalk.blue("→"),
      chalk.white(`${file.filename} applying...`),
    );
    const migration: MigrationPushMeta = {
      version: file.version,
      filename: file.filename,
      checksum: file.checksum,
    };
    const skipped = await pushMigrationFile({
      slug: input.slug,
      hash: input.hash,
      mode: input.mode,
      content: file.content,
      migration,
      options: input.options,
    });
    if (skipped) {
      console.log(
        chalk.green("✓"),
        chalk.white(`${file.filename} already applied`),
      );
      skippedCount += 1;
    } else {
      console.log(chalk.green("✓"), chalk.white(`${file.filename} applied`));
      appliedCount += 1;
    }
  }

  console.log();
  console.log(
    chalk.white(
      `Done. ${String(appliedCount)} applied, ${String(skippedCount)} skipped.`,
    ),
  );
}

async function fetchAppliedMigrations(input: {
  slug: string;
  hash: string;
  mode: string;
}): Promise<FluxMigrationRecord[]> {
  if (input.mode === "v2_shared") {
    return listAppliedMigrationsV2(input);
  }
  const client = getApiClient();
  return client.listAppliedMigrations(input.hash);
}

async function listAppliedMigrationsV2(input: {
  slug: string;
  hash: string;
}): Promise<FluxMigrationRecord[]> {
  const secret = await resolveProjectJwtSecret();
  const token = mintServiceRoleJwt(secret, input.hash);
  const base = resolveDashboardBase();
  const url = new URL(
    `/api/projects/${encodeURIComponent(input.slug)}/migrations`,
    base.endsWith("/") ? base : `${base}/`,
  );
  url.searchParams.set("hash", input.hash);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text.trim() ? (JSON.parse(text) as unknown) : null;
  } catch {
    throw new Error(
      `flux push (v2): migrations list was not JSON (${String(res.status)}).`,
    );
  }
  if (!res.ok) {
    throw new Error(formatV2ServerError(res.status, body));
  }
  if (
    !body ||
    typeof body !== "object" ||
    !("applied" in body) ||
    !Array.isArray((body as { applied: unknown }).applied)
  ) {
    throw new Error("flux push (v2): unexpected migrations list response.");
  }
  return (body as { applied: FluxMigrationRecord[] }).applied;
}

async function pushMigrationFile(input: {
  slug: string;
  hash: string;
  mode: string;
  content: string;
  migration: MigrationPushMeta;
  options: CmdPushOptions;
}): Promise<boolean> {
  if (Buffer.byteLength(input.content, "utf8") > MAX_SQL_BYTES) {
    throw new Error(
      `${input.migration.filename} is larger than 4 MiB (server limit for flux push).`,
    );
  }
  if (input.mode === "v2_shared") {
    return pushSqlV2Migration({
      slug: input.slug,
      hash: input.hash,
      sql: input.content,
      migration: input.migration,
    });
  }
  const client = getApiClient();
  const result = await client.pushSql({
    slug: input.slug,
    hash: input.hash,
    sql: input.content,
    migration: input.migration,
  });
  return result.skipped === true;
}

async function pushSqlV1(input: {
  slug: string;
  hash: string;
  sqlPath: string;
  options: CmdPushOptions;
}): Promise<void> {
  const client = getApiClient();
  const spinner = ora("Applying SQL…").start();
  const emptyReport: ImportSqlFileResult = {
    tablesMoved: 0,
    sequencesMoved: 0,
    viewsMoved: 0,
  };
  let result: ImportSqlFileResult = emptyReport;
  try {
    if (input.options.supabaseCompat) {
      spinner.stop();
      console.log(
        chalk.dim(
          "  Supabase compatibility mode. Remote control plane applies the raw SQL as-is; local transforms are not run.",
        ),
      );
      if (input.options.disableApiRls) {
        console.log(
          chalk.dim("  (RLS options are not applied on remote push yet.)"),
        );
      }
      spinner.start("Applying…");
    }
    result = await client.importSqlFile(input.slug, input.sqlPath, input.hash, {
      supabaseCompat: input.options.supabaseCompat,
      sanitizeForTarget: !input.options.noSanitize,
      moveFromPublic: input.options.supabaseCompat,
      ...(input.options.disableApiRls
        ? { disableRowLevelSecurityInApi: true as const }
        : {}),
    });
  } finally {
    spinner.stop();
  }
  console.log(chalk.green("✓"), chalk.white("SQL applied successfully."));
  if (input.options.supabaseCompat) {
    sectionBanner("Post-migration report");
    console.log(
      `  ${chalk.white("Tables moved to api:".padEnd(28))}${chalk.cyan(String(result.tablesMoved))}`,
    );
    console.log(
      `  ${chalk.white("Sequences moved to api:".padEnd(28))}${chalk.cyan(String(result.sequencesMoved))}`,
    );
    console.log(
      `  ${chalk.white("Views / matviews moved to api:".padEnd(28))}${chalk.cyan(String(result.viewsMoved))}`,
    );
    console.log();
  }
}

async function pushSqlV2(input: {
  slug: string;
  hash: string;
  sqlPath: string;
}): Promise<void> {
  const sql = await readFile(input.sqlPath, "utf8");
  await pushSqlV2Migration({
    slug: input.slug,
    hash: input.hash,
    sql,
  });
}

async function pushSqlV2Migration(input: {
  slug: string;
  hash: string;
  sql: string;
  migration?: MigrationPushMeta;
}): Promise<boolean> {
  const fileStat = Buffer.byteLength(input.sql, "utf8");
  if (fileStat > MAX_SQL_BYTES) {
    throw new Error(
      "SQL file is larger than 4 MiB (server limit for flux push).",
    );
  }

  const secret = await resolveProjectJwtSecret();
  const token = mintServiceRoleJwt(secret, input.hash);

  const base = resolveDashboardBase();
  const url = new URL(
    `/api/projects/${encodeURIComponent(input.slug)}/push`,
    base.endsWith("/") ? base : `${base}/`,
  );

  const spinner = ora(
    input.migration ? `Applying ${input.migration.filename}…` : "Applying SQL via Dashboard…",
  ).start();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        hash: input.hash,
        sql: input.sql,
        ...(input.migration ? { migration: input.migration } : {}),
      }),
    });
  } finally {
    spinner.stop();
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text.trim() ? (JSON.parse(text) as unknown) : null;
  } catch {
    throw new Error(
      `flux push (v2): response was not JSON (${String(res.status)}). Check FLUX_DASHBOARD_BASE or FLUX_API_BASE.`,
    );
  }

  if (!res.ok) {
    throw new Error(formatV2ServerError(res.status, body));
  }
  if (
    body &&
    typeof body === "object" &&
    "skipped" in body &&
    (body as { skipped: unknown }).skipped === true
  ) {
    return true;
  }
  return false;
}

function formatV2ServerError(status: number, body: unknown): string {
  const obj = (body && typeof body === "object" ? body : {}) as Record<
    string,
    unknown
  >;
  const message =
    typeof obj.error === "string" && obj.error.trim()
      ? obj.error
      : `Request failed (${String(status)})`;
  const tail: string[] = [];
  if (typeof obj.sqlState === "string") tail.push(`SQLSTATE ${obj.sqlState}`);
  if (typeof obj.position === "string") tail.push(`position ${obj.position}`);
  if (typeof obj.hint === "string") tail.push(`hint: ${obj.hint}`);
  if (tail.length === 0) return message;
  return `${message} (${tail.join("; ")})`;
}

async function resolveProjectJwtSecret(): Promise<string> {
  const fromEnv = process.env.FLUX_GATEWAY_JWT_SECRET?.trim();
  if (fromEnv) return fromEnv;
  const dotenv = await readEnvFile(process.cwd());
  const fromFile = dotenv.FLUX_GATEWAY_JWT_SECRET?.trim();
  if (fromFile) return fromFile;
  throw new Error(
    "FLUX_GATEWAY_JWT_SECRET is not set. Run `flux project credentials` and paste the printed line into your local .env (same value as the project's jwt_secret).",
  );
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/=+$/u, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * Mints a 60-second HS256 JWT carrying `role: "service_role"` for the given
 * project hash. Built on `node:crypto` to keep the CLI dependency-light
 * (per Flux project rules: prefer Node built-ins).
 */
export function mintServiceRoleJwt(secret: string, hash: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    role: "service_role",
    hash,
    iat: now,
    nbf: now - 5,
    exp: now + 60,
  };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = base64UrlEncode(
    createHmac("sha256", secret).update(signingInput).digest(),
  );
  return `${signingInput}.${signature}`;
}

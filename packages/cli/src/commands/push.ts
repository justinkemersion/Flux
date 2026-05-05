import { createHmac } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { LEGACY_FLUX_API_SCHEMA } from "@flux/core";
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

export async function cmdPush(
  file: string,
  project: string,
  options: CmdPushOptions,
  flux: FluxJson | null,
): Promise<void> {
  const abs = resolve(process.cwd(), file);
  try {
    await access(abs);
  } catch {
    throw new Error(`SQL file not found or not accessible: ${abs}`);
  }

  const slug = resolveProjectSlug(project, flux, "-p, --project");
  const hash = resolveHash(options.hash, flux);
  const client = getApiClient();

  const metadata = await client.getProjectMetadata(hash);

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
    await pushSqlV2({ slug, hash, sqlPath: abs });
    console.log(chalk.green("✓"), chalk.white("SQL applied successfully."));
    return;
  }

  await pushSqlV1({
    slug,
    hash,
    sqlPath: abs,
    options,
  });
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

/**
 * v2_shared (pooled) push:
 * 1. Resolve the project's HS256 secret from the local environment
 *    (`FLUX_GATEWAY_JWT_SECRET` — same value as `projects.jwt_secret`).
 * 2. Mint a short-lived `service_role` JWT with built-in `crypto`.
 * 3. POST the raw SQL to the Dashboard's per-project push endpoint, which
 *    runs it inside the tenant schema on the shared cluster.
 */
async function pushSqlV2(input: {
  slug: string;
  hash: string;
  sqlPath: string;
}): Promise<void> {
  const fileStat = await stat(input.sqlPath);
  if (fileStat.size > MAX_SQL_BYTES) {
    throw new Error(
      "SQL file is larger than 4 MiB (server limit for flux push).",
    );
  }
  const sql = await readFile(input.sqlPath, "utf8");

  const secret = await resolveProjectJwtSecret();
  const token = mintServiceRoleJwt(secret, input.hash);

  const base = resolveDashboardBase();
  const url = new URL(
    `/api/projects/${encodeURIComponent(input.slug)}/push`,
    base.endsWith("/") ? base : `${base}/`,
  );

  const spinner = ora("Applying SQL via Dashboard…").start();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ hash: input.hash, sql }),
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

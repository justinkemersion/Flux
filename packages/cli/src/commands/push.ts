import { access, readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { LEGACY_FLUX_API_SCHEMA } from "@flux/core";
import {
  listMigrationSqlFiles,
  loadLocalMigrations,
  migrationChecksum,
  migrationConflictMessage,
  migrationPlanTimeline,
  planMigrations,
  type MigrationPushMeta,
} from "@flux/core/sql-migrations";
import {
  defaultRepeatableScriptId,
  repeatableAppliedMessage,
  repeatableChangedReapplyMessage,
  repeatableForceApplyMessage,
  repeatableApplyingMessage,
  repeatableUnchangedSkipMessage,
  type RepeatablePushMeta,
  versionedMigrationConflictMessage,
} from "@flux/core/sql-repeatable-scripts";
import type { ImportSqlFileResult } from "@flux/core/standalone";
import chalk from "chalk";
import ora from "ora";
import { getApiClient } from "../api-client";
import { sectionBanner } from "../cli-layout";
import { resolveDashboardBase } from "../dashboard-base";
import type { FluxJson } from "../flux-config";
import {
  fetchAppliedMigrations,
  formatV2ServerError,
  mintServiceRoleJwt,
  resolveProjectJwtSecret,
} from "../lib/migrations-remote";
import {
  assertMigrationPlanReadyForDryRun,
  type MigrationPushMode,
  printMigrationPlan,
  printMigrationPlanSummary,
  printSingleFilePushPreview,
} from "../lib/migrations-output";
import {
  assertDirectoryPushScriptMode,
  assertForceRequiresRepeatable,
  resolvePushScriptMode,
} from "../lib/push-script-mode";
import { resolveHash, resolveProjectSlug } from "../project-resolve";

export { mintServiceRoleJwt } from "../lib/migrations-remote";

const MAX_SQL_BYTES = 4 * 1024 * 1024;

export type CmdPushOptions = {
  supabaseCompat: boolean;
  noSanitize: boolean;
  disableApiRls: boolean;
  hash?: string;
  pushMode: MigrationPushMode;
  explicitScriptMode?: string;
  force?: boolean;
  scriptId?: string;
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
    if (options.force) {
      throw new Error("--force requires --mode repeatable on a single SQL file.");
    }
    if (options.explicitScriptMode?.trim()) {
      assertDirectoryPushScriptMode(
        resolvePushScriptMode({
          explicitMode: options.explicitScriptMode,
          resolvedFilePath: target.path,
        }),
      );
    }
  } else if (options.explicitScriptMode || options.force || options.scriptId) {
    const scriptMode = resolvePushScriptMode({
      explicitMode: options.explicitScriptMode,
      resolvedFilePath: target.path,
    });
    assertForceRequiresRepeatable(options.force === true, scriptMode);
  }

  if (target.kind === "file" && options.pushMode !== "apply") {
    const schemaHint =
      metadata.mode === "v1_dedicated"
        ? `${metadata.mode}, schema ${metadata.apiSchema ?? LEGACY_FLUX_API_SCHEMA}`
        : metadata.mode;
    if (options.pushMode === "dry-run") {
      const st = await stat(target.path);
      if (st.size > MAX_SQL_BYTES) {
        throw new Error(
          "SQL file is larger than 4 MiB (server limit for flux push).",
        );
      }
    }
    printSingleFilePushPreview({
      filePath: target.path,
      slug,
      schemaHint,
      mode: options.pushMode,
    });
    return;
  }

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
  const scriptMode = resolvePushScriptMode({
    explicitMode: options.explicitScriptMode,
    resolvedFilePath: file,
  });
  assertForceRequiresRepeatable(options.force === true, scriptMode);

  const schemaHint =
    metadata.mode === "v1_dedicated"
      ? `${metadata.mode}, schema ${metadata.apiSchema ?? LEGACY_FLUX_API_SCHEMA}`
      : metadata.mode;

  if (scriptMode === "raw") {
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
      await pushSqlV2Raw({ slug, hash, sqlPath: file });
    } else {
      await pushSqlV1({
        slug,
        hash,
        sqlPath: file,
        options,
      });
    }
    console.log(chalk.green("✓"), chalk.white("SQL applied successfully."));
    return;
  }

  const raw = await readFile(file, "utf8");
  const filename = basename(file);

  if (scriptMode === "versioned") {
    const checksum = migrationChecksum(raw);
    const migration: MigrationPushMeta = {
      version: filename,
      filename,
      checksum,
    };
    console.log(
      chalk.blue(
        `Applying ${chalk.bold(filename)} to project ${chalk.bold(slug)} (${chalk.dim(schemaHint)})…`,
      ),
    );
    try {
      const skipped = await pushMigrationFile({
        slug,
        hash,
        mode: metadata.mode,
        content: raw,
        migration,
        options,
      });
      if (skipped) {
        console.log(
          chalk.green("✓"),
          chalk.white(`${filename} already applied`),
        );
      } else {
        console.log(chalk.green("✓"), chalk.white(`${filename} applied`));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/checksum conflict|different checksum/i.test(msg)) {
        const match = /Applied checksum: ([a-f0-9]{64})/u.exec(msg);
        throw new Error(
          versionedMigrationConflictMessage(migration, match?.[1] ?? "?", checksum),
        );
      }
      throw err;
    }
    return;
  }

  const scriptId =
    options.scriptId?.trim() ||
    defaultRepeatableScriptId(file, process.cwd());
  const checksum = migrationChecksum(raw);
  const repeatable: RepeatablePushMeta = {
    scriptId,
    filename,
    checksum,
    ...(options.force ? { force: true } : {}),
  };

  if (options.force) {
    console.log(chalk.blue(repeatableForceApplyMessage(scriptId)));
  } else {
    console.log(chalk.blue(repeatableApplyingMessage(scriptId)));
  }

  const result = await pushRepeatableFile({
    slug,
    hash,
    mode: metadata.mode,
    content: raw,
    repeatable,
    options,
  });

  if (result.skipped) {
    console.log(chalk.dim(repeatableUnchangedSkipMessage(scriptId)));
    return;
  }

  if (result.previousChecksum) {
    console.log(
      chalk.blue(
        repeatableChangedReapplyMessage(
          scriptId,
          result.previousChecksum,
          checksum,
        ),
      ),
    );
  }

  console.log(chalk.green(repeatableAppliedMessage(scriptId, checksum)));
}

async function cmdPushMigrationsDir(input: {
  dir: string;
  slug: string;
  hash: string;
  mode: string;
  schemaHint: string;
  options: CmdPushOptions;
}): Promise<void> {
  const pushMode = input.options.pushMode;
  const banner =
    pushMode === "plan"
      ? "Flux migrations (plan)"
      : pushMode === "dry-run"
        ? "Flux migrations (dry run)"
        : "Flux migrations";
  sectionBanner(banner);
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

  if (pushMode === "plan" || pushMode === "dry-run") {
    const counts = printMigrationPlan({ plan, mode: pushMode });
    if (pushMode === "dry-run") {
      assertMigrationPlanReadyForDryRun(plan);
    }
    printMigrationPlanSummary({
      mode: pushMode,
      wouldApply: counts.wouldApply,
      wouldSkip: counts.wouldSkip,
      conflicts: counts.conflicts,
    });
    return;
  }

  for (const { file, appliedChecksum } of plan.conflicts) {
    throw new Error(migrationConflictMessage(file, appliedChecksum));
  }

  let appliedCount = 0;
  let skippedCount = 0;

  for (const entry of migrationPlanTimeline(plan)) {
    const { file, status } = entry;
    if (status === "skip") {
      console.log(
        chalk.green("✓"),
        chalk.white(`${file.filename} already applied`),
      );
      skippedCount += 1;
      continue;
    }
    if (status !== "apply") {
      continue;
    }
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

  printMigrationPlanSummary({
    mode: "apply",
    wouldApply: 0,
    wouldSkip: 0,
    conflicts: 0,
    appliedCount,
    skippedCount,
  });
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

async function pushRepeatableFile(input: {
  slug: string;
  hash: string;
  mode: string;
  content: string;
  repeatable: RepeatablePushMeta;
  options: CmdPushOptions;
}): Promise<{ skipped: boolean; previousChecksum?: string }> {
  if (Buffer.byteLength(input.content, "utf8") > MAX_SQL_BYTES) {
    throw new Error(
      `${input.repeatable.filename} is larger than 4 MiB (server limit for flux push).`,
    );
  }
  if (input.mode === "v2_shared") {
    return pushSqlV2Push({
      slug: input.slug,
      hash: input.hash,
      sql: input.content,
      repeatable: input.repeatable,
    });
  }
  const client = getApiClient();
  const result = await client.pushSql({
    slug: input.slug,
    hash: input.hash,
    sql: input.content,
    repeatable: input.repeatable,
  });
  return {
    skipped: result.skipped === true,
    ...(result.previousChecksum ? { previousChecksum: result.previousChecksum } : {}),
  };
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

async function pushSqlV2Raw(input: {
  slug: string;
  hash: string;
  sqlPath: string;
}): Promise<void> {
  const sql = await readFile(input.sqlPath, "utf8");
  await pushSqlV2Push({
    slug: input.slug,
    hash: input.hash,
    sql,
  });
}

type PushSqlV2Result = { skipped: boolean; previousChecksum?: string };

async function pushSqlV2Push(input: {
  slug: string;
  hash: string;
  sql: string;
  migration?: MigrationPushMeta;
  repeatable?: RepeatablePushMeta;
}): Promise<PushSqlV2Result> {
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
    input.repeatable
      ? `Applying ${input.repeatable.scriptId}…`
      : input.migration
        ? `Applying ${input.migration.filename}…`
        : "Applying SQL via Dashboard…",
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
        ...(input.repeatable ? { repeatable: input.repeatable } : {}),
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
  const skipped =
    body &&
    typeof body === "object" &&
    "skipped" in body &&
    (body as { skipped: unknown }).skipped === true;
  const previousChecksum =
    body &&
    typeof body === "object" &&
    "previousChecksum" in body &&
    typeof (body as { previousChecksum?: unknown }).previousChecksum === "string"
      ? (body as { previousChecksum: string }).previousChecksum
      : undefined;
  return {
    skipped: skipped === true,
    ...(previousChecksum ? { previousChecksum } : {}),
  };
}

async function pushSqlV2Migration(input: {
  slug: string;
  hash: string;
  sql: string;
  migration: MigrationPushMeta;
}): Promise<boolean> {
  const result = await pushSqlV2Push(input);
  return result.skipped;
}


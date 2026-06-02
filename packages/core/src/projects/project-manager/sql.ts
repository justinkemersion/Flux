import {
  buildApiSchemaPrivilegesSql,
  buildDisableRowLevelSecurityForSchemaSql,
} from "../../api-schema-privileges.ts";
import {
  assertFluxApiSchemaIdentifier,
  LEGACY_FLUX_API_SCHEMA,
} from "../../api-schema-strategy.ts";
import { buildBootstrapSql } from "../../database/bootstrap-sql.ts";
import { deriveTenantPostgresPasswordFromSecret } from "../../database/tenant-postgres-password.ts";
import {
  materializePreparedSqlFile,
  queryPostgresMajorVersion,
  type ImportSqlFileOptions,
} from "../../import-dump.ts";
import {
  queryPsqlJsonRows,
  queryPsqlScalar,
  runPsqlHostFileInsideContainer,
  runPsqlSqlInsideContainer,
} from "../../postgres-internal-exec.ts";
import { runMovePublicSchemaToTargetWithDockerExec } from "../../schema-move-public-to-api.ts";
import {
  buildFluxMigrationsLedgerEnsureSql,
  buildMigrationPushSql,
  listFluxMigrationsSql,
  migrationConflictMessage,
  normalizePushSql,
  type FluxMigrationRecord,
  type MigrationPushMeta,
  resolveMigrationLedgerAction,
  selectMigrationChecksumSql,
} from "../../sql-migrations.ts";
import {
  buildRepeatableLedgerEnsureSql,
  buildRepeatablePushSql,
  resolveRepeatableLedgerAction,
  selectRepeatableChecksumSql,
  type RepeatablePushMeta,
} from "../../sql-repeatable-scripts.ts";
import { POSTGRES_USER } from "../../docker/docker-constants.ts";
import { postgrestContainerName } from "../../docker/docker-names.ts";
import type { FluxCoreContext } from "../../runtime/context.ts";
import type { ImportSqlFileResult } from "../../standalone.ts";
import { slugifyProjectName } from "../../standalone.ts";
import { getDockerEngineHttpStatus } from "../delete-docker-tenant-stack.ts";
import { resolveRunningPostgresCredentials } from "./credentials.ts";

/**
 * Runs arbitrary SQL against an existing Flux project's Postgres instance.
 *
 * Resolves the running DB container and `POSTGRES_PASSWORD` from Docker inspect, then runs
 * **`psql` via `docker exec`** inside that container (no TCP from the control plane to Postgres;
 * works with remote Docker daemons). After SQL, asks PostgREST to reload its schema cache:
 * `NOTIFY pgrst, 'reload schema'` (handled by PostgREST’s DB listener), a short pause, then
 * **SIGUSR1** on the API container. PostgREST documents SIGUSR1 for schema reload; SIGHUP does
 * not reload the schema cache.
 */
export async function executeSql(
  ctx: FluxCoreContext,
  projectName: string,
  sql: string,
  hash: string,
): Promise<void> {
  const { slug, containerId, password } =
    await resolveRunningPostgresCredentials(ctx, projectName, hash);
  await runPsqlSqlInsideContainer(
    ctx.docker,
    containerId,
    password,
    sql,
    POSTGRES_USER,
  );
  await runPsqlSqlInsideContainer(
    ctx.docker,
    containerId,
    password,
    `NOTIFY pgrst, 'reload schema';`,
    POSTGRES_USER,
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  const apiName = postgrestContainerName(hash, slug);
  try {
    await ctx.docker.getContainer(apiName).kill({ signal: "SIGUSR1" });
  } catch (err: unknown) {
    const code = getDockerEngineHttpStatus(err);
    if (code === 404 || code === 409) return;
    throw err;
  }
}

/**
 * Lists applied SQL migrations from `flux.flux_migrations` (empty if ledger never created).
 */
export async function listAppliedSqlMigrations(
  ctx: FluxCoreContext,
  projectName: string,
  hash: string,
  tenantSchema: string,
): Promise<FluxMigrationRecord[]> {
  try {
    const rows = await queryTenantJsonRows(
      ctx,
      projectName,
      hash,
      listFluxMigrationsSql(tenantSchema),
    );
    return rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        version: String(r.version ?? ""),
        filename: String(r.filename ?? ""),
        checksum: String(r.checksum ?? ""),
        ...(r.appliedAt != null ? { appliedAt: String(r.appliedAt) } : {}),
      };
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/does not exist|undefined_table|42P01|3F000/i.test(msg)) {
      return [];
    }
    throw err;
  }
}

/**
 * Data-plane SQL push (CLI / control plane): runs the script in a **single** transaction, ends with
 * `NOTIFY pgrst, 'reload schema'`, then `SIGUSR1` on the PostgREST API container. Uses `psql` via
 * `docker exec` to the running tenant DB (works with remote Docker; no host TCP to tenant PG).
 *
 * If `FLUX_PROJECT_PASSWORD_SECRET` or `FLUX_DEV_POSTGRES_PASSWORD` is set, requires the
 * HMAC-derived password to match the container’s `POSTGRES_PASSWORD` (see
 * {@link deriveTenantPostgresPasswordFromSecret}).
 */
export async function pushSqlFromCli(
  ctx: FluxCoreContext,
  projectName: string,
  hash: string,
  sql: string,
  options?: {
    searchPathSchemas?: readonly string[];
    migration?: MigrationPushMeta;
    repeatable?: RepeatablePushMeta;
  },
): Promise<{ skipped: boolean; previousChecksum?: string }> {
  const creds = await resolveRunningPostgresCredentials(ctx, projectName, hash);
  const secret =
    process.env.FLUX_PROJECT_PASSWORD_SECRET?.trim() ||
    process.env.FLUX_DEV_POSTGRES_PASSWORD?.trim();
  if (secret) {
    const derived = deriveTenantPostgresPasswordFromSecret(
      secret,
      creds.hash,
      creds.slug,
    );
    if (derived !== creds.password) {
      throw new Error(
        "HMAC password check failed: FLUX_PROJECT_PASSWORD_SECRET or FLUX_DEV_POSTGRES_PASSWORD does not match this project's running Postgres (POSTGRES_PASSWORD).",
      );
    }
  }

  let pathList = "api, public";
  let tenantSchema: string;
  if (options?.searchPathSchemas && options.searchPathSchemas.length > 0) {
    for (const s of options.searchPathSchemas) {
      assertFluxApiSchemaIdentifier(s);
    }
    tenantSchema = options.searchPathSchemas[0]!;
    pathList = options.searchPathSchemas.join(", ");
  } else {
    tenantSchema = LEGACY_FLUX_API_SCHEMA;
  }

  let userSql = normalizePushSql(sql);
  let skipped = false;
  let previousChecksum: string | undefined;
  const migration = options?.migration;
  const repeatable = options?.repeatable;
  if (migration && repeatable) {
    throw new Error("Provide only one of migration or repeatable metadata");
  }
  if (migration) {
    await runPsqlSqlInsideContainer(
      ctx.docker,
      creds.containerId,
      creds.password,
      buildFluxMigrationsLedgerEnsureSql(tenantSchema),
      POSTGRES_USER,
    );
    const lookupSql = selectMigrationChecksumSql(
      migration.version,
      tenantSchema,
    );
    let existingChecksum: string | undefined;
    try {
      const scalar = await queryPsqlScalar(
        ctx.docker,
        creds.containerId,
        creds.password,
        lookupSql,
        POSTGRES_USER,
      );
      existingChecksum = scalar.length > 0 ? scalar : undefined;
    } catch {
      existingChecksum = undefined;
    }
    const action = resolveMigrationLedgerAction(
      existingChecksum ? { checksum: existingChecksum } : undefined,
      migration,
    );
    if (action === "conflict") {
      throw new Error(
        migrationConflictMessage(migration, existingChecksum!),
      );
    }
    if (action === "skip") {
      skipped = true;
    } else {
      userSql = buildMigrationPushSql({
        tenantSchema,
        userSql,
        migration,
      });
    }
  } else if (repeatable) {
    await runPsqlSqlInsideContainer(
      ctx.docker,
      creds.containerId,
      creds.password,
      buildRepeatableLedgerEnsureSql(tenantSchema),
      POSTGRES_USER,
    );
    const lookupSql = selectRepeatableChecksumSql(
      repeatable.scriptId,
      tenantSchema,
    );
    let existingChecksum: string | undefined;
    try {
      const scalar = await queryPsqlScalar(
        ctx.docker,
        creds.containerId,
        creds.password,
        lookupSql,
        POSTGRES_USER,
      );
      existingChecksum = scalar.length > 0 ? scalar : undefined;
    } catch {
      existingChecksum = undefined;
    }
    const action = resolveRepeatableLedgerAction(
      existingChecksum ? { checksum: existingChecksum } : undefined,
      repeatable,
      repeatable.force === true,
    );
    if (action === "skip") {
      skipped = true;
    } else {
      if (
        existingChecksum &&
        existingChecksum !== repeatable.checksum
      ) {
        previousChecksum = existingChecksum;
      }
      userSql = buildRepeatablePushSql({
        tenantSchema,
        userSql,
        meta: repeatable,
      });
    }
  }

  if (!skipped) {
    const wrapped = `BEGIN;\nSET LOCAL search_path TO ${pathList};\n${userSql}\nNOTIFY pgrst, 'reload schema';\nCOMMIT;\n`;
    await runPsqlSqlInsideContainer(
      ctx.docker,
      creds.containerId,
      creds.password,
      wrapped,
      POSTGRES_USER,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    const apiName = postgrestContainerName(hash, creds.slug);
    try {
      await ctx.docker.getContainer(apiName).kill({ signal: "SIGUSR1" });
    } catch (err: unknown) {
      const code = getDockerEngineHttpStatus(err);
      if (code === 404 || code === 409) {
        return { skipped, ...(previousChecksum ? { previousChecksum } : {}) };
      }
      throw err;
    }
  }
  return { skipped, ...(previousChecksum ? { previousChecksum } : {}) };
}

/**
 * Applies a plain SQL dump by uploading a tar via the Docker API and running **`psql -f`** inside
 * the Postgres container (no host TCP to Postgres; works with remote Docker daemons).
 *
 * By default, strips session `SET` lines that the tenant Postgres version does not support (see
 * {@link preparePlainSqlDumpForFlux}). Use {@link ImportSqlFileOptions} for Supabase-style dumps.
 *
 * After the dump applies, always re-runs {@link API_SCHEMA_PRIVILEGES_SQL} so `anon` /
 * `authenticated` keep `USAGE`/`SELECT`/DML on all tables in `api` (including objects from the
 * dump). Optional {@link ImportSqlFileOptions.disableRowLevelSecurityInApi} turns off RLS on
 * imported tables that still have it enabled (common when porting from Supabase).
 *
 * Returns counts of objects moved when {@link ImportSqlFileOptions.moveFromPublic} is true.
 */
export async function importSqlFile(
  ctx: FluxCoreContext,
  slug: string,
  filePath: string,
  hash: string,
  options?: ImportSqlFileOptions,
): Promise<ImportSqlFileResult> {
  const emptyResult: ImportSqlFileResult = {
    tablesMoved: 0,
    sequencesMoved: 0,
    viewsMoved: 0,
  };

  const apiSchema = options?.apiSchemaName?.trim() || LEGACY_FLUX_API_SCHEMA;
  assertFluxApiSchemaIdentifier(apiSchema);

  const { slug: normalizedSlug, containerId, password } =
    await resolveRunningPostgresCredentials(ctx, slug, hash);

  const materialized = await materializePreparedSqlFile(
    filePath,
    options,
    () => queryPostgresMajorVersion(ctx.docker, containerId, password),
  );

  try {
    await runPsqlHostFileInsideContainer(
      ctx.docker,
      containerId,
      password,
      materialized.path,
      POSTGRES_USER,
    );

    let moveResult = emptyResult;
    if (options?.moveFromPublic === true) {
      moveResult = await runMovePublicSchemaToTargetWithDockerExec(
        ctx.docker,
        containerId,
        password,
        POSTGRES_USER,
        apiSchema,
      );
    }

    await runPsqlSqlInsideContainer(
      ctx.docker,
      containerId,
      password,
      buildApiSchemaPrivilegesSql(apiSchema),
      POSTGRES_USER,
    );
    if (options?.disableRowLevelSecurityInApi === true) {
      await runPsqlSqlInsideContainer(
        ctx.docker,
        containerId,
        password,
        buildDisableRowLevelSecurityForSchemaSql(apiSchema),
        POSTGRES_USER,
      );
    }

    await runPsqlSqlInsideContainer(
      ctx.docker,
      containerId,
      password,
      `NOTIFY pgrst, 'reload schema';`,
      POSTGRES_USER,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    const apiName = postgrestContainerName(hash, normalizedSlug);
    try {
      await ctx.docker.getContainer(apiName).kill({ signal: "SIGUSR1" });
    } catch (err: unknown) {
      const code = getDockerEngineHttpStatus(err);
      if (code === 404 || code === 409) return moveResult;
      throw err;
    }

    return moveResult;
  } finally {
    await materialized.cleanup();
  }
}

/**
 * Drops the tenant API schema and replays a plain SQL file (e.g. `pg_dump` output), then reapplies
 * Flux grants and signals PostgREST to reload.
 */
export async function replaceTenantApiSchemaFromPlainSqlFile(
  ctx: FluxCoreContext,
  projectName: string,
  hash: string,
  hostFilePath: string,
  apiSchemaName: string,
): Promise<void> {
  assertFluxApiSchemaIdentifier(apiSchemaName);
  const { containerId, password, slug } =
    await resolveRunningPostgresCredentials(ctx, projectName, hash);
  const q = `"${apiSchemaName.replace(/"/g, '""')}"`;
  await runPsqlSqlInsideContainer(
    ctx.docker,
    containerId,
    password,
    `DROP SCHEMA IF EXISTS ${q} CASCADE;`,
    POSTGRES_USER,
  );
  const materialized = await materializePreparedSqlFile(
    hostFilePath,
    { sanitizeForTarget: true },
    () => queryPostgresMajorVersion(ctx.docker, containerId, password),
  );
  try {
    await runPsqlHostFileInsideContainer(
      ctx.docker,
      containerId,
      password,
      materialized.path,
      POSTGRES_USER,
    );
    await runPsqlSqlInsideContainer(
      ctx.docker,
      containerId,
      password,
      buildApiSchemaPrivilegesSql(apiSchemaName),
      POSTGRES_USER,
    );
    await runPsqlSqlInsideContainer(
      ctx.docker,
      containerId,
      password,
      `NOTIFY pgrst, 'reload schema';`,
      POSTGRES_USER,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    const apiName = postgrestContainerName(hash, slug);
    try {
      await ctx.docker.getContainer(apiName).kill({ signal: "SIGUSR1" });
    } catch (err: unknown) {
      const code = getDockerEngineHttpStatus(err);
      if (code !== 404 && code !== 409) throw err;
    }
  } finally {
    await materialized.cleanup();
  }
}

/**
 * Runs a read-only SELECT inside the tenant Postgres container; rows as JSON objects.
 */
export async function queryTenantJsonRows(
  ctx: FluxCoreContext,
  projectName: string,
  hash: string,
  selectSql: string,
): Promise<unknown[]> {
  const { containerId, password } =
    await resolveRunningPostgresCredentials(ctx, projectName, hash);
  return queryPsqlJsonRows(
    ctx.docker,
    containerId,
    password,
    selectSql,
    POSTGRES_USER,
  );
}

/**
 * Drops `public` and `auth` (if present) and reapplies {@link BOOTSTRAP_SQL} so the next
 * {@link importSqlFile} runs against a clean slate. Does not remove the Docker volume (use
 * {@link nukeProject} for that).
 */
export async function resetTenantDatabaseForImport(
  ctx: FluxCoreContext,
  projectName: string,
  hash: string,
  options?: { apiSchemaName?: string },
): Promise<void> {
  const apiSchema = options?.apiSchemaName?.trim() || LEGACY_FLUX_API_SCHEMA;
  assertFluxApiSchemaIdentifier(apiSchema);
  const { containerId, password } =
    await resolveRunningPostgresCredentials(ctx, projectName, hash);
  const qApi = `"${apiSchema.replace(/"/g, '""')}"`;
  const qLegacy = `"${LEGACY_FLUX_API_SCHEMA.replace(/"/g, '""')}"`;
  const dropLegacyApi =
    apiSchema !== LEGACY_FLUX_API_SCHEMA
      ? `DROP SCHEMA IF EXISTS ${qLegacy} CASCADE;\n`
      : "";
  const resetSql = `
DROP SCHEMA IF EXISTS ${qApi} CASCADE;
${dropLegacyApi}DROP SCHEMA IF EXISTS auth CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
ALTER SCHEMA public OWNER TO postgres;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
COMMENT ON SCHEMA public IS 'standard public schema';
`.trim();
  await runPsqlSqlInsideContainer(
    ctx.docker,
    containerId,
    password,
    resetSql,
    POSTGRES_USER,
  );
  await runPsqlSqlInsideContainer(
    ctx.docker,
    containerId,
    password,
    buildBootstrapSql(apiSchema),
    POSTGRES_USER,
  );
}

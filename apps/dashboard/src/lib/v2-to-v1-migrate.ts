import { unlink } from "node:fs/promises";
import { and, eq, type InferSelectModel } from "drizzle-orm";
import { Client } from "pg";
import type { ProjectManager } from "@flux/core";
import {
  fluxMigrationStatusIsActiveLease,
  FLUX_GATEWAY_DRAINING_MIGRATION_STATUS,
  FLUX_SILENT_MIGRATION_MUTEX_STATUS,
  resolveTenantApiSchemaName,
} from "@flux/core";
import {
  assertPgDumpOnPath,
  assertSchemaOwnershipComment,
  assertSequenceSnapshotsMatch,
  assertSharedPostgresUrlConfigured,
  buildMigrationPlanFromCatalogRow,
  loadPreflight,
  pgDumpTenantSchemaToFile,
  snapshotSequencesInSchema,
  type MigrateApiResult,
  type MigrateCliPayload,
  type MigrationPlan,
  type SequenceSnapshot,
} from "@flux/migrate";
import { deprovisionProject } from "@flux/engine-v2";
import { domains, projects } from "@/src/db/schema";
import type { SystemDb } from "@/src/lib/db";
import { generateProjectJwtSecret } from "@/src/lib/provisioning-engine";
import { evictHostnames, v2SharedGatewayCacheHostnames } from "@/src/lib/gateway-cache";
import { validateDedicatedPostgrestOpenApi } from "@/src/lib/migrate-postgrest-validate";

export type ProjectRowForMigrate = InferSelectModel<typeof projects>;

export type MigrationLeaseResult =
  | { ok: true; row: ProjectRowForMigrate }
  | { ok: false; reason: "not_found" | "busy" };

/**
 * Takes a row lock on the project, then sets a migration lease status so a second
 * concurrent `flux migrate` fails fast. Uses {@link FLUX_SILENT_MIGRATION_MUTEX_STATUS}
 * when `lockWrites` is false so the gateway does not 503 tenant traffic.
 */
export async function claimProjectMigrationLease(
  db: SystemDb,
  userId: string,
  slug: string,
  hash: string,
  lockWrites: boolean,
): Promise<MigrationLeaseResult> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.userId, userId),
          eq(projects.slug, slug),
          eq(projects.hash, hash),
        ),
      )
      .for("update")
      .limit(1);
    const locked = rows[0];
    if (!locked) {
      return { ok: false, reason: "not_found" };
    }
    if (fluxMigrationStatusIsActiveLease(locked.migrationStatus)) {
      return { ok: false, reason: "busy" };
    }
    const next = lockWrites
      ? FLUX_GATEWAY_DRAINING_MIGRATION_STATUS
      : FLUX_SILENT_MIGRATION_MUTEX_STATUS;
    await tx
      .update(projects)
      .set({ migrationStatus: next })
      .where(eq(projects.id, locked.id));
    const [after] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, locked.id))
      .limit(1);
    return { ok: true, row: after ?? locked };
  });
}

function sharedPostgresUrl(): string {
  assertSharedPostgresUrlConfigured();
  return process.env.FLUX_SHARED_POSTGRES_URL!.trim();
}

async function withSharedClient<T>(
  fn: (query: (sql: string) => Promise<Record<string, unknown>[]>) => Promise<T>,
): Promise<T> {
  const c = new Client({ connectionString: sharedPostgresUrl() });
  await c.connect();
  try {
    return await fn(async (sql) => {
      const r = await c.query(sql);
      return r.rows as Record<string, unknown>[];
    });
  } finally {
    await c.end();
  }
}

async function snapshotTargetSequences(
  pm: ProjectManager,
  projectName: string,
  hash: string,
  schemaName: string,
): Promise<SequenceSnapshot> {
  const lit = schemaName.replace(/'/g, "''");
  const rows = (await pm.queryTenantJsonRows(
    projectName,
    hash,
    `
    SELECT sequencename::text AS name, last_value::text AS last
    FROM pg_sequences
    WHERE schemaname = '${lit}'
    ORDER BY sequencename
    `,
  )) as { name?: string; last?: string }[];
  const m = new Map<string, string>();
  for (const r of rows) {
    if (typeof r.name === "string" && typeof r.last === "string") {
      m.set(r.name, r.last);
    }
  }
  return m;
}

async function collectDomainHostnames(
  db: SystemDb,
  projectId: string,
): Promise<string[]> {
  const rows = await db
    .select({ hostname: domains.hostname })
    .from(domains)
    .where(eq(domains.projectId, projectId));
  return rows.map((r) => r.hostname.toLowerCase());
}

export async function runV2SharedToV1DedicatedMigration(input: {
  db: SystemDb;
  pm: ProjectManager;
  userId: string;
  payload: MigrateCliPayload;
}): Promise<MigrateApiResult> {
  const { db, pm, userId, payload } = input;
  const slug = payload.slug.trim();
  const hash = payload.hash.trim().toLowerCase();
  const isProd = process.env.NODE_ENV === "production";

  const lockWrites = payload.noLockWrites ? false : payload.lockWrites !== false;

  let [row] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.userId, userId),
        eq(projects.slug, slug),
        eq(projects.hash, hash),
      ),
    )
    .limit(1);

  if (!row) {
    return { ok: false, phase: "failed", error: "Project not found." };
  }

  if (fluxMigrationStatusIsActiveLease(row.migrationStatus)) {
    return {
      ok: false,
      phase: "failed",
      error: "Migration already in progress for this project.",
    };
  }

  let plan: MigrationPlan;
  try {
    plan = buildMigrationPlanFromCatalogRow(row, {
      preserveJwtSecret: payload.preserveJwtSecret !== false,
      lockWrites,
    });
  } catch (e: unknown) {
    return {
      ok: false,
      phase: "failed",
      error: e instanceof Error ? e.message : String(e),
    };
  }

  let preflight: Awaited<ReturnType<typeof loadPreflight>>;
  try {
    preflight = await withSharedClient((q) => loadPreflight(q, plan));
  } catch (e: unknown) {
    return {
      ok: false,
      phase: "failed",
      error: e instanceof Error ? e.message : String(e),
    };
  }
  try {
    assertSchemaOwnershipComment(plan, preflight);
  } catch (e: unknown) {
    return {
      ok: false,
      phase: "failed",
      error: e instanceof Error ? e.message : String(e),
    };
  }

  if (payload.dryRun) {
    return { ok: true, dryRun: true, plan, preflight };
  }

  if (!payload.yes) {
    return {
      ok: false,
      phase: "planning",
      error: "Refusing to migrate without --yes (destructive operation).",
    };
  }

  if (payload.staged === true && payload.newJwtSecret === true) {
    return {
      ok: false,
      phase: "planning",
      error:
        "--new-jwt-secret cannot be combined with --staged (catalog jwt_secret would not match the dedicated stack). Re-run a full migrate to rotate secrets.",
    };
  }

  if (payload.dumpOnly === true) {
    try {
      assertSharedPostgresUrlConfigured();
      assertPgDumpOnPath();
      const path = await pgDumpTenantSchemaToFile({
        databaseUrl: sharedPostgresUrl(),
        plan,
      });
      return {
        ok: true,
        plan,
        preflight,
        message: `pg_dump wrote ${path} (remove manually when done).`,
      };
    } catch (e: unknown) {
      return {
        ok: false,
        phase: "failed",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  assertSharedPostgresUrlConfigured();
  assertPgDumpOnPath();

  const lease = await claimProjectMigrationLease(db, userId, slug, hash, lockWrites);
  if (!lease.ok) {
    if (lease.reason === "not_found") {
      return { ok: false, phase: "failed", error: "Project not found." };
    }
    return {
      ok: false,
      phase: "failed",
      error: "Migration already in progress for this project.",
    };
  }
  row = lease.row;

  const jwtSecret =
    payload.newJwtSecret === true || !plan.preserveJwtSecret
      ? generateProjectJwtSecret()
      : row.jwtSecret!.trim();

  const hasMigrationLease = true;
  let dumpPath: string | null = null;
  try {
    if (lockWrites) {
      const hosts = [
        ...v2SharedGatewayCacheHostnames(slug, hash, isProd),
        ...(await collectDomainHostnames(db, row.id)),
      ];
      await evictHostnames(hosts);
    }

    await pm.nukeContainersOnly(slug, hash).catch(() => undefined);
    await pm.removeTenantPrivateNetworkAllowMissing(slug, hash);

    await pm.provisionProject(
      row.name,
      {
        isProduction: isProd,
        customJwtSecret: jwtSecret,
        apiSchemaName: plan.tenantSchema,
      },
      hash,
    );

    dumpPath = await pgDumpTenantSchemaToFile({
      databaseUrl: sharedPostgresUrl(),
      plan,
    });

    await pm.replaceTenantApiSchemaFromPlainSqlFile(
      slug,
      hash,
      dumpPath,
      plan.tenantSchema,
    );

    function qI(ident: string): string {
      return `"${ident.replace(/"/g, '""')}"`;
    }
    for (const { table, n: srcN } of preflight.tableCounts) {
      const sql = `SELECT count(*)::text AS c FROM ${qI(plan.tenantSchema)}.${qI(table)}`;
      const tgtRows = (await pm.queryTenantJsonRows(
        row.name,
        hash,
        sql,
      )) as { c?: string }[];
      const tgtN = Number.parseInt(String(tgtRows[0]?.c ?? "0"), 10);
      if (tgtN !== srcN) {
        throw new Error(
          `Row count mismatch for "${table}": source ${String(srcN)} vs target ${String(tgtN)}`,
        );
      }
    }

    const srcSeq = await withSharedClient((q) =>
      snapshotSequencesInSchema(q, plan.tenantSchema),
    );
    const tgtSeq = await snapshotTargetSequences(
      pm,
      row.name,
      hash,
      plan.tenantSchema,
    );
    assertSequenceSnapshotsMatch(srcSeq, tgtSeq, plan.tenantSchema);

    await validateDedicatedPostgrestOpenApi({
      slug,
      hash,
      isProduction: isProd,
      jwtSecret,
      tenantSchema: plan.tenantSchema,
    });

    if (!payload.staged) {
      const apiSchemaStrategy = "tenant_schema";
      const resolvedName = resolveTenantApiSchemaName({
        id: row.id,
        mode: "v1_dedicated",
        apiSchemaName: null,
        apiSchemaStrategy,
      });
      await db
        .update(projects)
        .set({
          mode: "v1_dedicated",
          jwtSecret: jwtSecret,
          migrationStatus: null,
          apiSchemaStrategy,
          apiSchemaName: resolvedName,
        })
        .where(eq(projects.id, row.id));

      await new Promise((r) => setTimeout(r, 150));

      const hosts = [
        ...v2SharedGatewayCacheHostnames(slug, hash, isProd),
        ...(await collectDomainHostnames(db, row.id)),
      ];
      await evictHostnames(hosts);
    } else {
      await db
        .update(projects)
        .set({ migrationStatus: null })
        .where(eq(projects.id, row.id));

      const hosts = [
        ...v2SharedGatewayCacheHostnames(slug, hash, isProd),
        ...(await collectDomainHostnames(db, row.id)),
      ];
      await evictHostnames(hosts);
    }

    if (payload.dropSourceAfter && !payload.staged) {
      await deprovisionProject(row.id);
    }

    return {
      ok: true,
      plan,
      preflight,
      message: payload.staged
        ? "Staged migration complete (catalog mode unchanged; target DB populated)."
        : "Migration complete. Project is now v1_dedicated.",
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, phase: "failed", error: msg };
  } finally {
    if (hasMigrationLease) {
      try {
        await db
          .update(projects)
          .set({ migrationStatus: null })
          .where(eq(projects.id, row.id));
      } catch {
        /* best-effort: catalog must not stay stuck on migration lease */
      }
    }
    if (dumpPath) {
      try {
        await unlink(dumpPath);
      } catch {
        /* ignore */
      }
    }
  }
}

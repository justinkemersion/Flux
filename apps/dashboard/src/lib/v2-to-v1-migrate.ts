import { unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Client } from "pg";
import type { ProjectManager } from "@flux/core";
import { resolveTenantApiSchemaName } from "@flux/core";
import {
  assertSchemaOwnershipComment,
  buildMigrationPlanFromCatalogRow,
  loadPreflight,
  pgDumpTenantSchemaToFile,
  type MigrateApiResult,
  type MigrateCliPayload,
  type MigrationPlan,
} from "@flux/migrate";
import { deprovisionProject } from "@flux/engine-v2";
import { domains, projects } from "@/src/db/schema";
import type { SystemDb } from "@/src/lib/db";
import { generateProjectJwtSecret } from "@/src/lib/provisioning-engine";
import { evictHostnames, v2SharedGatewayCacheHostnames } from "@/src/lib/gateway-cache";

function requireSharedUrl(): string {
  const u = process.env.FLUX_SHARED_POSTGRES_URL?.trim();
  if (!u) {
    throw new Error(
      "FLUX_SHARED_POSTGRES_URL is required for v2→v1 migration (pg_dump source).",
    );
  }
  return u;
}

async function withSharedClient<T>(
  fn: (query: (sql: string) => Promise<Record<string, unknown>[]>) => Promise<T>,
): Promise<T> {
  const c = new Client({ connectionString: requireSharedUrl() });
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

  const [row] = await db
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

  if (row.migrationStatus === "migrating") {
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

  const preflight = await withSharedClient((q) => loadPreflight(q, plan));
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

  if (payload.dumpOnly === true) {
    const path = await pgDumpTenantSchemaToFile({
      databaseUrl: requireSharedUrl(),
      plan,
    });
    return {
      ok: true,
      plan,
      preflight,
      message: `pg_dump wrote ${path} (remove manually when done).`,
    };
  }

  const jwtSecret =
    payload.newJwtSecret === true || !plan.preserveJwtSecret
      ? generateProjectJwtSecret()
      : row.jwtSecret!.trim();

  let dumpPath: string | null = null;
  try {
    if (lockWrites) {
      await db
        .update(projects)
        .set({ migrationStatus: "migrating" })
        .where(eq(projects.id, row.id));
      const hosts = [
        ...v2SharedGatewayCacheHostnames(slug, hash, isProd),
        ...(await collectDomainHostnames(db, row.id)),
      ];
      await evictHostnames(hosts);
    }

    await pm.nukeContainersOnly(slug, hash).catch(() => undefined);
    await pm.removeTenantPrivateNetworkAllowMissing(slug, hash);

    await pm.provisionProject(row.name, {
      isProduction: isProd,
      customJwtSecret: jwtSecret,
      apiSchemaName: plan.tenantSchema,
    }, hash);

    dumpPath = await pgDumpTenantSchemaToFile({
      databaseUrl: requireSharedUrl(),
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
    await db
      .update(projects)
      .set({ migrationStatus: null })
      .where(eq(projects.id, row.id));
    return { ok: false, phase: "failed", error: msg };
  } finally {
    if (dumpPath) {
      try {
        await unlink(dumpPath);
      } catch {
        /* ignore */
      }
    }
  }
}

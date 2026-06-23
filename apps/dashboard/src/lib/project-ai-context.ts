import "server-only";

import { classifyNewestBackup, formatBackupTrustSummary } from "@flux/core/backup-trust";
import type { BackupKind } from "@flux/core/backup-trust";
import type {
  ProjectAiActivityLine,
  ProjectAiContext,
  ProjectAiTableSummary,
} from "@flux/core/project-ai-prompts";
import { and, eq } from "drizzle-orm";
import { projects } from "@/src/db/schema";
import type { SystemDb } from "@/src/lib/db";
import { listProjectActivityEvents } from "@/src/lib/project-activity";
import { listProjectAppliedMigrations } from "@/src/lib/project-applied-migrations";
import { getProjectFluxMdById } from "@/src/lib/project-flux-md";
import { getProjectMetadataById } from "@/src/lib/project-metadata";
import { inspectProjectSchema } from "@/src/lib/project-schema-inspection";
import { resolveTenantApiSchemaName } from "@flux/core";
import { listBackupsForProject } from "@/src/lib/project-backups";

export type ProjectAiLookup = {
  id: string;
  slug: string;
  hash: string;
  name: string;
  mode: "v1_dedicated" | "v2_shared";
  lifecycleState: string;
  apiSchemaName: string | null;
  apiSchemaStrategy: string | null;
};

const MAX_TABLES_IN_CONTEXT = 24;
const MAX_ACTIVITY_LINES = 20;

function compactTables(tables: Array<{
  name: string;
  estimatedRows?: number;
  rls: { enabled: boolean };
  columns: Array<{ name: string }>;
}>): ProjectAiTableSummary[] {
  return tables.slice(0, MAX_TABLES_IN_CONTEXT).map((t) => ({
    name: t.name,
    rowCount: t.estimatedRows ?? null,
    rlsEnabled: t.rls.enabled,
    columns: t.columns.slice(0, 12).map((c) => c.name),
  }));
}

export async function gatherProjectAiContext(
  db: SystemDb,
  project: ProjectAiLookup,
): Promise<ProjectAiContext> {
  const [meta, fluxMd, events, migrations, backups] = await Promise.all([
    getProjectMetadataById(db, project.id),
    getProjectFluxMdById(db, project.id),
    listProjectActivityEvents(db, project.id, MAX_ACTIVITY_LINES),
    listProjectAppliedMigrations(project).catch(() => null),
    listBackupsForProject(project.id).catch(() => []),
  ]);

  let schemaSummary: ProjectAiContext["schemaSummary"] = null;
  let schemaNote: string | null = null;
  let apiSchema: string | null = null;

  try {
    const inspection = await inspectProjectSchema(project);
    apiSchema = inspection.project.schema;
    schemaSummary = {
      tableCount: inspection.summary.tableCount,
      tables: compactTables(inspection.tables),
    };
    if (inspection.summary.tableCount > MAX_TABLES_IN_CONTEXT) {
      schemaNote = `Showing first ${String(MAX_TABLES_IN_CONTEXT)} of ${String(inspection.summary.tableCount)} tables.`;
    }
  } catch (err: unknown) {
    schemaNote =
      err instanceof Error
        ? err.message
        : "Schema inspection unavailable (project may be stopped or unreachable).";
    apiSchema = resolveTenantApiSchemaName({
      id: project.id,
      mode: project.mode,
      apiSchemaName: project.apiSchemaName,
      apiSchemaStrategy: project.apiSchemaStrategy as
        | "legacy_api"
        | "tenant_schema"
        | null,
    });
  }

  const recentActivity: ProjectAiActivityLine[] = events.map((e) => ({
    kind: e.kind,
    summary: e.summary,
    createdAt: e.createdAt,
  }));

  let backupTrustSummary: string | null = null;
  const latest = backups[0];
  if (latest) {
    const classification = classifyNewestBackup(
      backups.map((r) => ({
        status: r.status,
        artifactValidationStatus: r.artifactValidationStatus,
        restoreVerificationStatus: r.restoreVerificationStatus,
        kind: r.kind as BackupKind,
      })),
    );
    const summary = formatBackupTrustSummary({
      classification,
      kind: (latest.kind as BackupKind) ?? "project_db",
      latestBackupCreatedAt:
        latest.createdAt instanceof Date
          ? latest.createdAt.toISOString()
          : String(latest.createdAt ?? ""),
    });
    backupTrustSummary = `${summary.verification}. ${summary.safeDestructive}.`;
  } else {
    backupTrustSummary = "No backups recorded.";
  }

  return {
    slug: project.slug,
    hash: project.hash,
    name: project.name,
    mode: project.mode,
    description: meta?.description ?? null,
    operatorBrief: meta?.brief ?? null,
    lifecycleState: project.lifecycleState,
    existingFluxMd: fluxMd?.content ?? null,
    apiSchema,
    schemaSummary,
    schemaNote,
    recentActivity,
    appliedMigrationCount: migrations?.length ?? null,
    backupTrustSummary,
  };
}

export async function loadOwnedProjectForAi(
  db: SystemDb,
  input: { slug: string; hash: string; userId: string },
): Promise<ProjectAiLookup | null> {
  const [row] = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      hash: projects.hash,
      name: projects.name,
      mode: projects.mode,
      lifecycleState: projects.lifecycleState,
      apiSchemaName: projects.apiSchemaName,
      apiSchemaStrategy: projects.apiSchemaStrategy,
    })
    .from(projects)
    .where(
      and(
        eq(projects.slug, input.slug),
        eq(projects.hash, input.hash),
        eq(projects.userId, input.userId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    mode: row.mode as "v1_dedicated" | "v2_shared",
    lifecycleState: row.lifecycleState ?? "active",
  };
}

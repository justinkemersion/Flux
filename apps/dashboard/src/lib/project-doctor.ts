import {
  backupTrustRemediationHint,
  classifyNewestBackup,
  formatBackupTrustSummary,
  type BackupKind,
} from "@flux/core/backup-trust";
import {
  classifyExposedSchemaSecurity,
  formatEffectivePrivileges,
  resolveTenantApiSchemaName,
  type ExposedTableSecurityFact,
} from "@flux/core";
import {
  inspectProjectExposedTableSecurity,
  inspectProjectSchema,
} from "./project-schema-inspection";
import { listPooledAppliedMigrations } from "./pooled-migrations";
import { probeV2SharedCatalogProject, probeTenantApiUrl } from "./tenant-api-probe";
import { getDb } from "./db";
import { projectBackups } from "@/src/db/schema";
import { and, desc, eq } from "drizzle-orm";

export type DoctorCheckStatus = "pass" | "warn" | "fail";

export type DoctorCheck = {
  name: string;
  status: DoctorCheckStatus;
  detail: string;
  remediation?: string;
};

export type DoctorReport = {
  projectSlug: string;
  hash: string;
  mode: "v1_dedicated" | "v2_shared";
  schema: string;
  checks: DoctorCheck[];
  /** Worst status across all checks. */
  overallStatus: DoctorCheckStatus;
  generatedAt: string;
};

type ProjectRow = {
  id: string;
  slug: string;
  hash: string;
  mode: string;
  jwtSecret: string | null;
  apiSchemaName: string | null;
  apiSchemaStrategy: string | null;
};

function worstStatus(checks: DoctorCheck[]): DoctorCheckStatus {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "pass";
}

function pass(name: string, detail: string): DoctorCheck {
  return { name, status: "pass", detail };
}
function warn(name: string, detail: string, remediation?: string): DoctorCheck {
  return { name, status: "warn", detail, ...(remediation ? { remediation } : {}) };
}
function fail(name: string, detail: string, remediation?: string): DoctorCheck {
  return { name, status: "fail", detail, ...(remediation ? { remediation } : {}) };
}

export function buildDedicatedRlsDoctorCheck(
  facts: readonly ExposedTableSecurityFact[],
): DoctorCheck {
  const report = classifyExposedSchemaSecurity(facts);
  if (report.overall === "pass") {
    return pass(
      "API schema RLS",
      facts.length === 0
        ? "No exposed tables yet"
        : `Protected — ${String(facts.length)} table${facts.length === 1 ? "" : "s"} have RLS and policies`,
    );
  }

  const failDetails = report.failures.map((finding) => {
    const privs = formatEffectivePrivileges(finding.privileges);
    return privs
      ? `${finding.qualifiedName} (${privs})`
      : finding.qualifiedName;
  });
  const warnDetails = report.warnings.map((finding) => finding.message);

  if (report.overall === "fail") {
    const extra =
      warnDetails.length > 0 ? `; warnings: ${warnDetails.join("; ")}` : "";
    return fail(
      "API schema RLS",
      `Unrestricted write on RLS-disabled table(s): ${failDetails.join("; ")}${extra}`,
      "Enable row level security and add policies, or revoke INSERT/UPDATE/DELETE/TRUNCATE from anon, authenticated, and PUBLIC. Flux does not rewrite the schema automatically.",
    );
  }

  return warn(
    "API schema RLS",
    warnDetails.join("; "),
    "Review RLS-disabled read exposure and tables that have RLS enabled without policies. Unrestricted reads may be intentional; add an explicit deny-all policy if a table should stay unused.",
  );
}

/**
 * Runs all project doctor checks and returns a structured DoctorReport.
 *
 * Checks run as concurrently as possible. Each check is independently
 * try/catched so one failure does not prevent others from running.
 */
export async function runProjectDoctor(project: ProjectRow): Promise<DoctorReport> {
  const mode = project.mode as "v1_dedicated" | "v2_shared";
  const isProduction = process.env.NODE_ENV === "production";

  const apiSchema = resolveTenantApiSchemaName({
    id: project.id,
    mode,
    apiSchemaName: project.apiSchemaName,
    apiSchemaStrategy: project.apiSchemaStrategy as
      | "legacy_api"
      | "tenant_schema"
      | null,
  });

  // Run independent checks in parallel.
  const [schemaResult, apiResult, backupResult] = await Promise.allSettled([
    // Check 1: DB reachable + schema exists (via schema inspection)
    inspectProjectSchema(project).then((r) => ({
      tableCount: r.summary.tableCount,
      schema: r.project.schema,
      tables: r.tables,
    })),

    // Check 2: API reachable
    mode === "v2_shared"
      ? probeV2SharedCatalogProject({
          slug: project.slug,
          hash: project.hash,
          isProduction,
          jwtSecret: project.jwtSecret,
        })
      : probeTenantApiUrl(project.slug, project.hash, isProduction, "v1_dedicated"),

    // Check 3: Backup trust
    getDb()
      .select({
        status: projectBackups.status,
        artifactValidationStatus: projectBackups.artifactValidationStatus,
        restoreVerificationStatus: projectBackups.restoreVerificationStatus,
        kind: projectBackups.kind,
        createdAt: projectBackups.createdAt,
      })
      .from(projectBackups)
      .where(and(eq(projectBackups.projectId, project.id)))
      .orderBy(desc(projectBackups.createdAt))
      .limit(5),
  ]);

  const checks: DoctorCheck[] = [];

  // Control plane + project found are implicit (caller already resolved the project).
  checks.push(pass("Control plane", "Reachable"));
  checks.push(pass("Project", `Found (${mode === "v2_shared" ? "v2 shared" : "v1 dedicated"})`));

  // DB / schema check
  if (schemaResult.status === "fulfilled") {
    const { tableCount } = schemaResult.value;
    checks.push(
      pass(
        "Database",
        tableCount === 0
          ? `Reachable — schema ${apiSchema} has no tables yet`
          : `Reachable — ${String(tableCount)} table${tableCount === 1 ? "" : "s"} in ${apiSchema}`,
      ),
    );
    if (mode === "v1_dedicated") {
      try {
        const facts = await inspectProjectExposedTableSecurity(project);
        checks.push(buildDedicatedRlsDoctorCheck(facts));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        checks.push(
          fail(
            "API schema RLS",
            `Inspection failed: ${msg.slice(0, 160)}`,
            "Confirm the dedicated Postgres container is running, then retry `flux doctor`.",
          ),
        );
      }
    }
  } else {
    const msg = schemaResult.reason instanceof Error
      ? schemaResult.reason.message
      : String(schemaResult.reason);
    const isContainerDown = /not running|No Postgres container|not found/i.test(msg);
    checks.push(
      fail(
        "Database",
        isContainerDown ? "Container not running or not found" : `Unreachable: ${msg.slice(0, 120)}`,
        isContainerDown
          ? "Run `flux start <project>` or check container status."
          : "Check FLUX_SHARED_POSTGRES_URL or container health.",
      ),
    );
  }

  // API probe check
  if (apiResult.status === "fulfilled") {
    checks.push(
      apiResult.value
        ? pass("API", "Reachable")
        : warn(
            "API",
            "Not reachable from control plane",
            "Check gateway and PostgREST container. Run `flux gauntlet run <project>` for a detailed probe.",
          ),
    );
  } else {
    checks.push(warn("API", "Probe failed — unable to reach tenant API endpoint"));
  }

  // Migration ledger check (v2: pooled query; v1: skip — no pooled ledger)
  if (mode === "v2_shared") {
    try {
      const applied = await listPooledAppliedMigrations({ tenantSchema: apiSchema });
      const tableCount =
        schemaResult.status === "fulfilled" ? schemaResult.value.tableCount : 0;

      if (applied.length === 0 && tableCount > 0) {
        checks.push(
          warn(
            "Migration ledger",
            `Readable — ledger is empty but ${String(tableCount)} table${tableCount === 1 ? "" : "s"} exist`,
            "Migrations were applied outside the versioned ledger (raw/repeatable push or pre-ledger). " +
              "Future migrations will be tracked; existing tables are unaffected.",
          ),
        );
      } else {
        checks.push(
          pass(
            "Migration ledger",
            applied.length === 0
              ? "Readable — no migrations applied yet"
              : `Readable — ${String(applied.length)} migration${applied.length === 1 ? "" : "s"} applied`,
          ),
        );
      }
    } catch (err) {
      checks.push(
        warn(
          "Migration ledger",
          `Could not read ledger: ${err instanceof Error ? err.message.slice(0, 80) : "unknown error"}`,
        ),
      );
    }
  }

  // Backup trust check
  if (backupResult.status === "fulfilled") {
    const rows = backupResult.value;
    const newestKind = (rows[0]?.kind ?? (mode === "v2_shared" ? "tenant_export" : "project_db")) as BackupKind;
    const classification = classifyNewestBackup(
      rows.map((r) => ({
        status: r.status,
        artifactValidationStatus: r.artifactValidationStatus,
        restoreVerificationStatus: r.restoreVerificationStatus,
        kind: r.kind as BackupKind,
      })),
    );
    const latestCreatedAt = rows[0]?.createdAt;
    const summary = formatBackupTrustSummary({
      classification,
      kind: newestKind,
      latestBackupCreatedAt:
        latestCreatedAt instanceof Date
          ? latestCreatedAt.toISOString()
          : (latestCreatedAt ?? null),
    });
    if (classification.tier === "restorable") {
      checks.push(
        pass(
          "Backup",
          `${summary.verification} — safe destructive actions allowed`,
        ),
      );
    } else if (classification.tier === "no_backups") {
      checks.push(
        warn(
          "Backup",
          `${summary.verification} — ${summary.safeDestructive.toLowerCase()}`,
          backupTrustRemediationHint(classification.tier),
        ),
      );
    } else {
      checks.push(
        warn(
          "Backup",
          `${summary.verification} — ${summary.safeDestructive.toLowerCase()}`,
          summary.actionHint ?? backupTrustRemediationHint(classification.tier),
        ),
      );
    }
  } else {
    checks.push(warn("Backup", "Could not read backup records"));
  }

  return {
    projectSlug: project.slug,
    hash: project.hash,
    mode,
    schema: apiSchema,
    checks,
    overallStatus: worstStatus(checks),
    generatedAt: new Date().toISOString(),
  };
}

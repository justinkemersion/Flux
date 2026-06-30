import { and, eq } from "drizzle-orm";
import { FLUX_PROJECT_HASH_HEX_LEN } from "@flux/core";
import { projects } from "@/src/db/schema";
import { auth } from "@/src/lib/auth";
import { extractBearerToken } from "@/src/lib/cli-api-auth";
import { authorizeCliHttpRequest, cliRouteAuthJsonError } from "@/src/lib/mcp-route-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getBackupStorage } from "@/src/lib/backup-storage";
import {
  absoluteBackupArtifactPath,
  createBackupForProject,
  formatLocalArtifactStatus,
  formatOffsiteR2StatusForRow,
  getProjectBackupFreshness,
  listBackupsForProject,
  reconcileListedBackupArtifacts,
  type BackupRow,
  type PlatformBackupProjectRow,
} from "@/src/lib/project-backups";
import { recordBackupCreatedActivity } from "@/src/lib/project-activity";
import { isR2OffsiteEnabled } from "@/src/lib/backup-storage";

function serializePlatformFreshness(
  freshness: Awaited<ReturnType<typeof getProjectBackupFreshness>>,
) {
  return {
    effectivePolicy: freshness.effectivePolicy,
    freshness: {
      tier: freshness.freshness.tier,
      ageDays: freshness.freshness.ageDays,
      dueInDays: freshness.freshness.dueInDays,
      latestRestoreVerifiedAt: freshness.freshness.latestRestoreVerifiedAt,
      platformBackupCompliant: freshness.freshness.platformBackupCompliant,
      detail: freshness.freshness.detail,
    },
  };
}

function serializeBackupForCli(row: BackupRow) {
  const r2Enabled = isR2OffsiteEnabled();
  return {
    id: row.id,
    kind: row.kind,
    /** Relative to FLUX_BACKUPS_LOCAL_DIR on the control plane (canonical layout). */
    primaryArtifactRelativePath: `${row.projectId}/${row.id}.dump`,
    /** Same artifact as resolved inside flux-web (named Docker volumes often hide this from host ls). */
    primaryArtifactAbsolutePath: absoluteBackupArtifactPath(row),
    format: row.format,
    status: row.status,
    sizeBytes: row.sizeBytes,
    checksumSha256: row.checksumSha256,
    createdAt: row.createdAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    localArtifactStatus: formatLocalArtifactStatus(row),
    offsiteStatus: row.offsiteStatus,
    offsiteProvider: row.offsiteProvider,
    offsiteBucket: row.offsiteBucket,
    offsiteKey: row.offsiteKey,
    offsiteCompletedAt: row.offsiteCompletedAt?.toISOString() ?? null,
    offsiteSizeBytes: row.offsiteSizeBytes,
    offsiteEtag: row.offsiteEtag,
    offsiteContentSha256: row.offsiteContentSha256,
    offsiteError: row.offsiteError,
    offsiteR2Status: formatOffsiteR2StatusForRow(row),
    r2OffsiteEnabled: r2Enabled,
    artifactValidationStatus: row.artifactValidationStatus,
    artifactValidationAt: row.artifactValidationAt?.toISOString() ?? null,
    artifactValidationError: row.artifactValidationError,
    restoreVerificationStatus: row.restoreVerificationStatus,
    restoreVerificationAt: row.restoreVerificationAt?.toISOString() ?? null,
    restoreVerificationError: row.restoreVerificationError,
  };
}

export const runtime = "nodejs";
export const maxDuration = 300;
/** Never serve stale backup rows (reconciliation mutates catalog truth per request). */
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ hash: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function isValidHash(h: string): boolean {
  return h.length === FLUX_PROJECT_HASH_HEX_LEN && /^[a-f0-9]+$/u.test(h);
}

async function resolveOwnedProject(
  req: Request,
  context: Ctx,
): Promise<
  | { project: PlatformBackupProjectRow & { mode: "v1_dedicated" | "v2_shared" } }
  | { error: Response }
> {
  await initSystemDb();
  const db = getDb();

  const { hash: rawHash } = await context.params;
  const hash = (rawHash ?? "").trim().toLowerCase();
  if (!isValidHash(hash)) {
    return {
      error: jsonError(
        `hash in path must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-char hex id`,
        400,
      ),
    };
  }

  const secret = extractBearerToken(req.headers.get("authorization"));
  let userId: string | null = null;
  if (secret) {
    const authResult = await authorizeCliHttpRequest(db, req, { projectHash: hash });
    if (!authResult.ok) {
      return { error: cliRouteAuthJsonError(authResult) };
    }
    userId = authResult.auth.userId;
  } else {
    const session = await auth();
    userId = session?.user?.id ?? null;
  }
  if (!userId) return { error: jsonError("Unauthorized", 401) };

  const [project] = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      hash: projects.hash,
      mode: projects.mode,
      userId: projects.userId,
      backupIntervalDays: projects.backupIntervalDays,
      backupRetentionCount: projects.backupRetentionCount,
      backupRetentionDays: projects.backupRetentionDays,
    })
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.hash, hash)))
    .limit(1);
  if (!project) return { error: jsonError("Project not found", 404) };
  return {
    project: {
      ...project,
      mode: project.mode as "v1_dedicated" | "v2_shared",
    },
  };
}

export async function GET(req: Request, context: Ctx): Promise<Response> {
  const resolved = await resolveOwnedProject(req, context);
  if ("error" in resolved) return resolved.error;

  const rows = await listBackupsForProject(resolved.project.id);
  const reconciled = await reconcileListedBackupArtifacts(rows);
  const storage = getBackupStorage();
  const platformFreshness = await getProjectBackupFreshness(resolved.project);
  return Response.json(
    {
      backups: reconciled.map(serializeBackupForCli),
      backupVolumeAbsoluteRoot: storage.absoluteLocalRoot(),
      reconciledAt: new Date().toISOString(),
      platformMinimumBackupFreshness: serializePlatformFreshness(
        platformFreshness,
      ),
    },
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      },
    },
  );
}

export async function POST(req: Request, context: Ctx): Promise<Response> {
  const resolved = await resolveOwnedProject(req, context);
  if ("error" in resolved) return resolved.error;

  try {
    const backup = await createBackupForProject({
      projectId: resolved.project.id,
      slug: resolved.project.slug,
      hash: resolved.project.hash,
      mode: resolved.project.mode,
    });
    await recordBackupCreatedActivity(getDb(), {
      projectId: resolved.project.id,
      userId: resolved.project.userId,
      backupId: backup.id,
      kind: backup.kind,
    });
    const platformFreshness = await getProjectBackupFreshness(resolved.project);
    return Response.json(
      {
        backup: serializeBackupForCli(backup),
        platformMinimumBackupFreshness: serializePlatformFreshness(
          platformFreshness,
        ),
      },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0, must-revalidate",
        },
      },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cli v1 backups POST]", err);
    if (/already running/i.test(msg)) {
      return jsonError(msg, 409);
    }
    return jsonError(msg, 500);
  }
}

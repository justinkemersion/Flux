import { and, eq } from "drizzle-orm";
import { FLUX_PROJECT_HASH_HEX_LEN } from "@flux/core";
import { projects } from "@/src/db/schema";
import { auth } from "@/src/lib/auth";
import { authenticateCliApiKey, extractBearerToken } from "@/src/lib/cli-api-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import {
  createBackupForProject,
  listBackupsForProject,
  reconcileListedBackupArtifacts,
  type BackupRow,
} from "@/src/lib/project-backups";

function serializeBackupForCli(row: BackupRow) {
  return {
    id: row.id,
    format: row.format,
    status: row.status,
    sizeBytes: row.sizeBytes,
    checksumSha256: row.checksumSha256,
    createdAt: row.createdAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    offsiteStatus: row.offsiteStatus,
    offsiteCompletedAt: row.offsiteCompletedAt?.toISOString() ?? null,
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
  | { project: { id: string; slug: string; hash: string; mode: "v1_dedicated" | "v2_shared" } }
  | { error: Response }
> {
  await initSystemDb();
  const db = getDb();
  const secret = extractBearerToken(req.headers.get("authorization"));
  const cliAuth = await authenticateCliApiKey(db, secret);
  const session = cliAuth ? null : await auth();
  const userId = cliAuth?.userId ?? session?.user?.id ?? null;
  if (!userId) return { error: jsonError("Unauthorized", 401) };

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

  const [project] = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      hash: projects.hash,
      mode: projects.mode,
    })
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.hash, hash)))
    .limit(1);
  if (!project) return { error: jsonError("Project not found", 404) };
  if (project.mode !== "v1_dedicated") {
    return { error: jsonError("Backups MVP currently supports v1_dedicated only.", 400) };
  }
  return { project };
}

export async function GET(req: Request, context: Ctx): Promise<Response> {
  const resolved = await resolveOwnedProject(req, context);
  if ("error" in resolved) return resolved.error;

  const rows = await listBackupsForProject(resolved.project.id);
  const reconciled = await reconcileListedBackupArtifacts(rows);
  return Response.json({
    backups: reconciled.map(serializeBackupForCli),
  });
}

export async function POST(req: Request, context: Ctx): Promise<Response> {
  const resolved = await resolveOwnedProject(req, context);
  if ("error" in resolved) return resolved.error;

  try {
    const backup = await createBackupForProject({
      projectId: resolved.project.id,
      slug: resolved.project.slug,
      hash: resolved.project.hash,
    });
    return Response.json({
      backup: serializeBackupForCli(backup),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cli v1 backups POST]", err);
    if (/already running/i.test(msg)) {
      return jsonError(msg, 409);
    }
    return jsonError(msg, 500);
  }
}

import { and, eq } from "drizzle-orm";
import { FLUX_PROJECT_HASH_HEX_LEN } from "@flux/core";
import { projectBackups, projects } from "@/src/db/schema";
import { auth } from "@/src/lib/auth";
import { extractBearerToken } from "@/src/lib/cli-api-auth";
import { authorizeCliHttpRequest, cliRouteAuthJsonError } from "@/src/lib/mcp-route-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import { verifyBackupRestore } from "@/src/lib/project-backups";
import { recordBackupVerifiedActivity } from "@/src/lib/project-activity";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ hash: string; backupId: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function isValidHash(h: string): boolean {
  return h.length === FLUX_PROJECT_HASH_HEX_LEN && /^[a-f0-9]+$/u.test(h);
}

export async function POST(req: Request, context: Ctx): Promise<Response> {
  await initSystemDb();
  const db = getDb();

  const { hash: rawHash, backupId } = await context.params;
  const hash = (rawHash ?? "").trim().toLowerCase();
  if (!isValidHash(hash)) {
    return jsonError(
      `hash in path must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-char hex id`,
      400,
    );
  }

  const secret = extractBearerToken(req.headers.get("authorization"));
  let userId: string | null = null;
  if (secret) {
    const authResult = await authorizeCliHttpRequest(db, req, { projectHash: hash });
    if (!authResult.ok) return cliRouteAuthJsonError(authResult);
    userId = authResult.auth.userId;
  } else {
    const session = await auth();
    userId = session?.user?.id ?? null;
  }
  if (!userId) return jsonError("Unauthorized", 401);

  const [ownerCheck] = await db
    .select({ id: projectBackups.id, projectId: projectBackups.projectId })
    .from(projectBackups)
    .innerJoin(projects, eq(projects.id, projectBackups.projectId))
    .where(
      and(
        eq(projects.userId, userId),
        eq(projects.hash, hash),
        eq(projectBackups.id, backupId),
      ),
    )
    .limit(1);
  if (!ownerCheck) return jsonError("Backup not found", 404);

  try {
    await verifyBackupRestore(backupId);
    await recordBackupVerifiedActivity(db, {
      projectId: ownerCheck.projectId,
      userId,
      backupId,
    });
    return Response.json({ ok: true, backupId, restoreVerificationStatus: "restore_verified" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cli v1 backups verify POST]", err);
    if (/already running/i.test(msg)) {
      return jsonError(msg, 409);
    }
    return jsonError(msg, 500);
  }
}

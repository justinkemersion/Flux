import { and, eq } from "drizzle-orm";
import { FLUX_PROJECT_HASH_HEX_LEN } from "@flux/core";
import { projectBackups, projects } from "@/src/db/schema";
import { auth } from "@/src/lib/auth";
import { authenticateCliApiKey, extractBearerToken } from "@/src/lib/cli-api-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import { verifyBackupRestore } from "@/src/lib/project-backups";

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
  const secret = extractBearerToken(req.headers.get("authorization"));
  const cliAuth = await authenticateCliApiKey(db, secret);
  const session = cliAuth ? null : await auth();
  const userId = cliAuth?.userId ?? session?.user?.id ?? null;
  if (!userId) return jsonError("Unauthorized", 401);

  const { hash: rawHash, backupId } = await context.params;
  const hash = (rawHash ?? "").trim().toLowerCase();
  if (!isValidHash(hash)) {
    return jsonError(
      `hash in path must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-char hex id`,
      400,
    );
  }
  const [ownerCheck] = await db
    .select({ id: projectBackups.id })
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
    return Response.json({ ok: true, backupId, restoreVerificationStatus: "restore_verified" });
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

import { and, eq } from "drizzle-orm";
import { projects } from "@/src/db/schema";
import {
  authenticateCliApiKey,
  extractBearerToken,
} from "@/src/lib/cli-api-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getProjectManager } from "@/src/lib/flux";
import { assertDestructiveBackupAllowed } from "@/src/lib/destructive-backup-gate";
import { runCliMigratePost } from "@/src/lib/destructive-project-routes";
import { runV2SharedToV1DedicatedMigration } from "@/src/lib/v2-to-v1-migrate";

export const runtime = "nodejs";

/**
 * POST /api/cli/v1/migrate
 * Bearer CLI key. Body: {@link MigrateCliPayload}
 */
export async function POST(req: Request): Promise<Response> {
  return runCliMigratePost(req, {
    initSystemDb,
    authenticateCli: async (authorizationHeader) => {
      const db = getDb();
      const secret = extractBearerToken(authorizationHeader);
      const auth = await authenticateCliApiKey(db, secret);
      return auth ? { userId: auth.userId } : null;
    },
    findOwnedProjectId: async ({ userId, slug, hash }) => {
      const db = getDb();
      const [row] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.userId, userId),
            eq(projects.slug, slug),
            eq(projects.hash, hash),
          ),
        )
        .limit(1);
      return row?.id ?? null;
    },
    assertDestructiveBackupAllowed,
    runMigration: async ({ userId, payload }) => {
      const db = getDb();
      const pm = getProjectManager();
      return runV2SharedToV1DedicatedMigration({
        db,
        pm,
        userId,
        payload,
      });
    },
  });
}

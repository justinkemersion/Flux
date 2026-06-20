import { and, eq } from "drizzle-orm";
import { projects } from "@/src/db/schema";
import {
  authenticateCliApiKey,
  extractBearerToken,
} from "@/src/lib/cli-api-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import {
  getProjectDbAccessPlan,
  logDbAccessAudit,
} from "@/src/lib/project-db-access";

export const runtime = "nodejs";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

type Ctx = { params: Promise<{ hash: string }> };

/**
 * GET /api/cli/v1/projects/:hash/db-access
 * Bearer CLI key. Returns redacted mode-aware database access metadata.
 */
export async function GET(req: Request, context: Ctx): Promise<Response> {
  await initSystemDb();
  const db = getDb();
  const secret = extractBearerToken(req.headers.get("authorization"));
  const auth = await authenticateCliApiKey(db, secret);
  if (!auth) {
    return jsonError("Unauthorized", 401);
  }

  const { hash: rawHash } = await context.params;
  const url = new URL(req.url);
  const localPortRaw = url.searchParams.get("localPort");
  const localPort =
    localPortRaw != null ? Number.parseInt(localPortRaw, 10) : undefined;

  const result = await getProjectDbAccessPlan(
    {
      hash: rawHash ?? "",
      actorUserId: auth.userId,
      options: {
        localPort:
          localPort != null && Number.isFinite(localPort) && localPort > 0
            ? localPort
            : undefined,
        sshHost: url.searchParams.get("sshHost") ?? undefined,
        sshUser: url.searchParams.get("sshUser") ?? undefined,
        sshPort: (() => {
          const raw = url.searchParams.get("sshPort");
          if (!raw) return undefined;
          const parsed = Number.parseInt(raw, 10);
          return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
        })(),
      },
    },
    {
      findOwnedProject: async (hash, userId) => {
        const [row] = await db
          .select({
            id: projects.id,
            slug: projects.slug,
            hash: projects.hash,
            mode: projects.mode,
            apiSchemaName: projects.apiSchemaName,
            apiSchemaStrategy: projects.apiSchemaStrategy,
            userId: projects.userId,
          })
          .from(projects)
          .where(and(eq(projects.userId, userId), eq(projects.hash, hash)))
          .limit(1);
        return row ?? null;
      },
      logAudit: logDbAccessAudit,
    },
  );

  if (!result.ok) {
    return jsonError(result.error, result.status);
  }

  return Response.json(result.plan, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

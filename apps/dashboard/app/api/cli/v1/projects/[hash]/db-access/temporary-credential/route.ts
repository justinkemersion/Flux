import { and, eq } from "drizzle-orm";
import {
  projectDbAccessAuditEvents,
  projectDbTempCredentials,
  projects,
} from "@/src/db/schema";
import {
  authenticateCliApiKey,
  extractBearerToken,
} from "@/src/lib/cli-api-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import {
  createProjectDbTempCredential,
  logDbTempCredentialAudit,
} from "@/src/lib/project-db-temp-credentials";

export const runtime = "nodejs";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

type Ctx = { params: Promise<{ hash: string }> };

/**
 * POST /api/cli/v1/projects/:hash/db-access/temporary-credential
 * Bearer CLI key. v2_shared only — returns username/password once.
 */
export async function POST(req: Request, context: Ctx): Promise<Response> {
  await initSystemDb();
  const db = getDb();
  const secret = extractBearerToken(req.headers.get("authorization"));
  const auth = await authenticateCliApiKey(db, secret);
  if (!auth) {
    return jsonError("Unauthorized", 401);
  }

  const { hash: rawHash } = await context.params;
  let body: { access?: string; ttlSeconds?: number } = {};
  try {
    body = (await req.json()) as { access?: string; ttlSeconds?: number };
  } catch {
    body = {};
  }

  const accessRaw = body.access?.trim().toLowerCase();
  const access =
    accessRaw === "readwrite"
      ? ("readwrite" as const)
      : accessRaw === "readonly" || accessRaw == null || accessRaw === ""
        ? ("readonly" as const)
        : null;
  if (!access) {
    return jsonError("access must be readonly or readwrite.", 400);
  }

  const ttlSeconds =
    body.ttlSeconds != null && Number.isFinite(body.ttlSeconds)
      ? Math.floor(body.ttlSeconds)
      : undefined;

  const result = await createProjectDbTempCredential(
    {
      hash: rawHash ?? "",
      actorUserId: auth.userId,
      access,
      ...(ttlSeconds != null ? { ttlSeconds } : {}),
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
      insertAuditEvent: async (event) => {
        await db.insert(projectDbAccessAuditEvents).values({
          projectId: event.projectId,
          userId: event.userId,
          event: "db_temp_credential_created",
          hash: event.hash,
          mode: event.mode,
          access: event.access,
          ttlSeconds: event.ttlSeconds,
          username: event.username,
          expiresAt: event.expiresAt,
        });
        logDbTempCredentialAudit({
          event: "db_temp_credential_created",
          userId: event.userId,
          hash: event.hash,
          mode: event.mode,
          access: event.access,
          ttlSeconds: event.ttlSeconds,
          username: event.username,
          expiresAt: event.expiresAt.toISOString(),
        });
      },
      insertTempCredential: async (row) => {
        await db.insert(projectDbTempCredentials).values(row);
      },
    },
  );

  if (!result.ok) {
    return jsonError(result.error, result.status);
  }

  return Response.json(result.credential, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

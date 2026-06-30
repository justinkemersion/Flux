import { eq } from "drizzle-orm";
import { users } from "@/src/db/schema";
import { extractBearerToken } from "@/src/lib/cli-api-auth";
import { isMcpControlPlaneAuth } from "@/src/lib/control-plane-auth";
import { authorizeCliRoute, cliRouteAuthJsonError } from "@/src/lib/mcp-route-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import { resolveCliRoleForUser } from "@/src/lib/cli-admin";
import { defaultModeForPlan } from "@/src/lib/cli-mode-policy";

export const runtime = "nodejs";

/**
 * GET /api/cli/v1/auth/verify
 * Authorization: Bearer flx_live_… or flx_mcp_…
 */
export async function GET(req: Request): Promise<Response> {
  await initSystemDb();
  const db = getDb();
  const secret = extractBearerToken(req.headers.get("authorization"));
  const authResult = await authorizeCliRoute(db, secret, {
    pathname: new URL(req.url).pathname,
    method: "GET",
  });
  if (!authResult.ok) {
    return cliRouteAuthJsonError(authResult);
  }
  const auth = authResult.auth;

  if (isMcpControlPlaneAuth(auth)) {
    return Response.json(
      {
        ok: true as const,
        tokenFamily: "mcp" as const,
        capabilities: auth.capabilities,
        projectIds: auth.projectIds,
        expiresAt: auth.expiresAt.toISOString(),
        keyPreview: auth.keyPreview,
        embeddedKeyId: auth.embeddedKeyId,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const [row] = await db
    .select({ name: users.name, email: users.email, plan: users.plan })
    .from(users)
    .where(eq(users.id, auth.userId))
    .limit(1);

  const user = row?.email?.trim() || row?.name?.trim() || auth.userId;
  const plan = row?.plan === "pro" ? "pro" : "hobby";
  const defaultMode = defaultModeForPlan(plan);
  const cliRole = resolveCliRoleForUser({
    userId: auth.userId,
    email: row?.email,
    name: row?.name,
  });

  return Response.json(
    { ok: true as const, user, plan, defaultMode, cliRole },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

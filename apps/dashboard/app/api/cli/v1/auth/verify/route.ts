import { eq } from "drizzle-orm";
import { users } from "@/src/db/schema";
import { authenticateCliApiKey, extractBearerToken } from "@/src/lib/cli-api-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import { defaultModeForPlan } from "@/src/lib/cli-mode-policy";

export const runtime = "nodejs";

/**
 * GET /api/cli/v1/auth/verify
 * Authorization: Bearer flx_live_…
 * Response includes profile metadata used by CLI default-mode selection.
 */
export async function GET(req: Request): Promise<Response> {
  await initSystemDb();
  const db = getDb();
  const secret = extractBearerToken(req.headers.get("authorization"));
  const auth = await authenticateCliApiKey(db, secret);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [row] = await db
    .select({ name: users.name, email: users.email, plan: users.plan })
    .from(users)
    .where(eq(users.id, auth.userId))
    .limit(1);

  const user =
    row?.email?.trim() || row?.name?.trim() || auth.userId;
  const plan = row?.plan === "pro" ? "pro" : "hobby";
  const defaultMode = defaultModeForPlan(plan);

  return Response.json(
    { ok: true as const, user, plan, defaultMode },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

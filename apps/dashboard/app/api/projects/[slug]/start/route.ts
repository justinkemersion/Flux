import type { NextRequest } from "next/server";
import { auth } from "@/src/lib/auth";
import { initSystemDb } from "@/src/lib/db";
import { applyProjectPowerAction } from "@/src/lib/project-lifecycle";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * POST /api/projects/[slug]/start
 * Session + ownership; starts containers and sets catalog `health_status` to `running`.
 */
export async function POST(
  _req: NextRequest,
  ctx: Ctx,
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const { slug } = await ctx.params;

  await initSystemDb();
  const result = await applyProjectPowerAction({
    slug,
    userId: session.user.id,
    action: "start",
  });
  if ("error" in result) {
    return jsonError(result.error, result.status);
  }
  return Response.json({ ok: true, action: "start" as const });
}

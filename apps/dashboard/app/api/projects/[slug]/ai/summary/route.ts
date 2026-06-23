import type { NextRequest } from "next/server";
import {
  projectAiKindLabel,
  type ProjectAiSummaryKind,
} from "@flux/core/project-ai-prompts";
import { auth } from "@/src/lib/auth";
import {
  acquireCodexInferenceSlot,
  extractClientIpFromHeaders,
} from "@/src/lib/ai-throttler";
import { CODEX_INFERENCE_QUOTA_EXCEEDED_MESSAGE } from "@/src/lib/codex-inference-messages";
import { getDb, initSystemDb } from "@/src/lib/db";
import { generateOwnedProjectAiSummary } from "@/src/lib/project-ai-generate";
import { isWorkersAiConfigured } from "@/src/lib/workers-ai-completion";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function parseHash(req: NextRequest): string | null {
  const hash = req.nextUrl.searchParams.get("hash")?.trim().toLowerCase() ?? "";
  if (!/^[a-f0-9]{7}$/u.test(hash)) return null;
  return hash;
}

function parseKind(raw: string | null): ProjectAiSummaryKind | null {
  const k = raw?.trim();
  if (k === "brief" || k === "activity" || k === "resume") return k;
  return null;
}

/**
 * POST /api/projects/[slug]/ai/summary?hash=<7hex>&kind=brief|activity|resume
 */
export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const hash = parseHash(req);
  if (!hash) return jsonError("Missing or invalid hash query param", 400);

  const kind = parseKind(req.nextUrl.searchParams.get("kind"));
  if (!kind) {
    return jsonError('Missing or invalid kind (brief, activity, or resume)', 400);
  }

  if (!isWorkersAiConfigured()) {
    return jsonError(
      "AI summaries are not configured on this Flux host (Cloudflare Workers AI). Use the copyable generation prompt instead.",
      503,
    );
  }

  const slot = await acquireCodexInferenceSlot({
    userId: session.user.id,
    clientIp: extractClientIpFromHeaders(req.headers),
  });
  if (!slot.allowed) {
    return jsonError(CODEX_INFERENCE_QUOTA_EXCEEDED_MESSAGE, 429);
  }

  const { slug } = await ctx.params;
  await initSystemDb();
  const db = getDb();

  try {
    const result = await generateOwnedProjectAiSummary(
      db,
      { slug, hash, userId: session.user.id },
      kind,
    );
    return Response.json({
      summary: {
        kind: result.kind,
        label: projectAiKindLabel(result.kind),
        markdown: result.markdown,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "Project not found") return jsonError(msg, 404);
    return jsonError(msg, 500);
  }
}

import { and, eq } from "drizzle-orm";
import { FLUX_PROJECT_HASH_HEX_LEN } from "@flux/core";
import {
  projectAiKindLabel,
  type ProjectAiSummaryKind,
} from "@flux/core/project-ai-prompts";
import { projects } from "@/src/db/schema";
import { extractBearerToken } from "@/src/lib/cli-api-auth";
import { authorizeCliHttpRequest, cliRouteAuthJsonError } from "@/src/lib/mcp-route-auth";
import { acquireCodexInferenceSlot } from "@/src/lib/ai-throttler";
import { CODEX_INFERENCE_QUOTA_EXCEEDED_MESSAGE } from "@/src/lib/codex-inference-messages";
import { getDb, initSystemDb } from "@/src/lib/db";
import { generateProjectAiSummary } from "@/src/lib/project-ai-generate";
import { isWorkersAiConfigured } from "@/src/lib/workers-ai-completion";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ hash: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function isValidHash(h: string): boolean {
  return h.length === FLUX_PROJECT_HASH_HEX_LEN && /^[a-f0-9]+$/u.test(h);
}

function parseKind(body: Record<string, unknown>): ProjectAiSummaryKind | null {
  const k = body.kind;
  if (k === "brief" || k === "activity" || k === "resume") return k;
  return null;
}

/**
 * POST /api/cli/v1/projects/[hash]/ai/summary
 * Body: { kind: "brief" | "activity" | "resume" }
 */
export async function POST(req: Request, context: Ctx): Promise<Response> {
  await initSystemDb();
  const db = getDb();
  const authResult = await authorizeCliHttpRequest(db, req);
  if (!authResult.ok) return cliRouteAuthJsonError(authResult);
  const auth = authResult.auth;

  const { hash: rawHash } = await context.params;
  const hash = rawHash.trim().toLowerCase();
  if (!isValidHash(hash)) {
    return jsonError(
      `hash must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-char lowercase hex id`,
      400,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  if (!body || typeof body !== "object") {
    return jsonError("Expected JSON object body", 400);
  }
  const record = body as Record<string, unknown>;
  const kind = parseKind(record);
  if (!kind) {
    return jsonError('Provide kind: "brief", "activity", or "resume"', 400);
  }

  if (!isWorkersAiConfigured()) {
    return jsonError(
      "AI summaries are not configured on this Flux host. Use `flux project brief prompt` for a copyable template.",
      503,
    );
  }

  const slot = await acquireCodexInferenceSlot({
    userId: auth.userId,
    clientIp: "",
  });
  if (!slot.allowed) {
    return jsonError(CODEX_INFERENCE_QUOTA_EXCEEDED_MESSAGE, 429);
  }

  const [row] = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      hash: projects.hash,
      name: projects.name,
      mode: projects.mode,
      lifecycleState: projects.lifecycleState,
      apiSchemaName: projects.apiSchemaName,
      apiSchemaStrategy: projects.apiSchemaStrategy,
    })
    .from(projects)
    .where(and(eq(projects.userId, auth.userId), eq(projects.hash, hash)))
    .limit(1);

  if (!row) return jsonError("Project not found for this API key", 404);

  try {
    const result = await generateProjectAiSummary(
      db,
      {
        ...row,
        mode: row.mode as "v1_dedicated" | "v2_shared",
        lifecycleState: row.lifecycleState ?? "active",
      },
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
    return jsonError(msg, 500);
  }
}

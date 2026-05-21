import { authenticateCliApiKey, extractBearerToken } from "@/src/lib/cli-api-auth";
import {
  assertWithinProjectLimit,
  buildInitPayloadFromCatalogRow,
  buildInitPayloadFromProvision,
  countUserProjects,
  findCatalogRowBySlug,
  initialApiSchemaStrategy,
  loadUserPlan,
  parseOptionalMode,
  parseOptionalStripSupabase,
  provisionProjectForUser,
  resolveCreateModeForPlan,
  slugifyProjectName,
} from "@/src/lib/cli-project-provision";
import { getDb, initSystemDb } from "@/src/lib/db";

export const runtime = "nodejs";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * POST /api/cli/v1/init
 * Authorization: Bearer flx_live_…
 * Body: `{ "slug": string, "stripSupabaseRestPrefix"?: boolean, "mode"?: "v1_dedicated" | "v2_shared" }`
 *
 * Idempotent Foundry entry: link existing (user, slug) or provision a new project.
 * Response omits secrets (unlike POST /create).
 */
export async function POST(req: Request): Promise<Response> {
  await initSystemDb();
  const db = getDb();
  const secret = extractBearerToken(req.headers.get("authorization"));
  const auth = await authenticateCliApiKey(db, secret);
  if (!auth) {
    return jsonError("Unauthorized", 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("slug" in body) ||
    typeof (body as { slug: unknown }).slug !== "string"
  ) {
    return jsonError('Expected JSON body with a string "slug" field', 400);
  }

  const rawSlug = (body as { slug: string }).slug.trim();
  if (!rawSlug) return jsonError("Project slug is required", 400);

  const bodyObj = body as Record<string, unknown>;
  const stripSupabaseRestPrefix = parseOptionalStripSupabase(bodyObj);
  const parsedMode = parseOptionalMode(bodyObj);
  if (parsedMode === "invalid") {
    return jsonError('Expected "mode" to be "v1_dedicated" or "v2_shared"', 400);
  }

  let slug: string;
  try {
    slug = slugifyProjectName(rawSlug);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 400);
  }

  if (slug !== rawSlug) {
    return jsonError(
      `slug must already be normalized (expected "${slug}", got "${rawSlug}").`,
      400,
    );
  }

  const isProduction = process.env.NODE_ENV === "production";
  const existing = await findCatalogRowBySlug(db, auth.userId, slug);
  if (existing) {
    const payload = buildInitPayloadFromCatalogRow(existing, isProduction);
    return Response.json(payload, {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  const plan = await loadUserPlan(db, auth.userId);
  const projectCount = await countUserProjects(db, auth.userId);
  const limitCheck = assertWithinProjectLimit(plan, projectCount);
  if (!limitCheck.ok) {
    return jsonError(limitCheck.message, 403);
  }

  const modePolicy = resolveCreateModeForPlan({ requestedMode: parsedMode, plan });
  if (!modePolicy.ok) {
    return jsonError(modePolicy.message, 403);
  }

  const result = await provisionProjectForUser({
    db,
    userId: auth.userId,
    projectName: rawSlug,
    slug,
    mode: modePolicy.mode,
    stripSupabaseRestPrefix,
    isProduction,
  });

  if (!result.ok) {
    return jsonError(result.message, result.status);
  }

  const payload = buildInitPayloadFromProvision(
    result.summary,
    result.mode,
    result.tenantId,
    initialApiSchemaStrategy(result.mode),
  );

  return Response.json(payload, {
    status: 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}

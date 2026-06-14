import { authenticateCliApiKey, extractBearerToken } from "@/src/lib/cli-api-auth";
import {
  assertWithinProjectLimit,
  countUserProjects,
  findCatalogRowBySlug,
  loadUserPlan,
  loadUserUnlimitedProjects,
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
 * POST /api/cli/v1/create
 * Authorization: Bearer flx_live_…
 * Body: `{ "name": string, "stripSupabaseRestPrefix"?: boolean, "mode"?: "v1_dedicated" | "v2_shared" }` — defaults by plan when omitted
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
    !("name" in body) ||
    typeof (body as { name: unknown }).name !== "string"
  ) {
    return jsonError('Expected JSON body with a string "name" field', 400);
  }

  const rawName = (body as { name: string }).name.trim();
  if (!rawName) return jsonError("Project name is required", 400);

  const bodyObj = body as Record<string, unknown>;
  const stripSupabaseRestPrefix = parseOptionalStripSupabase(bodyObj);
  const parsedMode = parseOptionalMode(bodyObj);
  if (parsedMode === "invalid") {
    return jsonError('Expected "mode" to be "v1_dedicated" or "v2_shared"', 400);
  }

  let slug: string;
  try {
    slug = slugifyProjectName(rawName);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 400);
  }

  const existing = await findCatalogRowBySlug(db, auth.userId, slug);
  if (existing) {
    return jsonError("You already have a project with this name.", 409);
  }

  const plan = await loadUserPlan(db, auth.userId);
  const projectCount = await countUserProjects(db, auth.userId);
  const unlimited = await loadUserUnlimitedProjects(db, auth.userId);
  const limitCheck = assertWithinProjectLimit(plan, projectCount, { unlimited });
  if (!limitCheck.ok) {
    return jsonError(limitCheck.message, 403);
  }

  const modePolicy = resolveCreateModeForPlan({ requestedMode: parsedMode, plan });
  if (!modePolicy.ok) {
    return jsonError(modePolicy.message, 403);
  }

  const isProduction = process.env.NODE_ENV === "production";
  const result = await provisionProjectForUser({
    db,
    userId: auth.userId,
    projectName: rawName,
    slug,
    mode: modePolicy.mode,
    stripSupabaseRestPrefix,
    isProduction,
  });

  if (!result.ok) {
    return jsonError(result.message, result.status);
  }

  const payload = {
    summary: result.summary,
    mode: result.mode,
    projectJwtSecret: result.projectJwtSecret,
    secrets: result.secrets,
  };

  return Response.json(payload, {
    status: 201,
    headers: { "Cache-Control": "private, no-store" },
  });
}

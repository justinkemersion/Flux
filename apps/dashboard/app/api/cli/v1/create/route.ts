import { and, count, eq } from "drizzle-orm";
import type { FluxProjectSummary } from "@flux/core/standalone";
import {
  generateProjectHash,
  slugifyProjectName,
} from "@flux/core";
import { projects, users } from "@/src/db/schema";
import { authenticateCliApiKey, extractBearerToken } from "@/src/lib/cli-api-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getProjectManager } from "@/src/lib/flux";
import { probeSingleProject } from "@/src/lib/fleet-monitor";
import { dispatchProvisionProject } from "@/src/lib/provisioning-engine";
import { resolveCreateModeForPlan } from "@/src/lib/cli-mode-policy";

export const runtime = "nodejs";

const HOBBY_PROJECT_LIMIT = 2;
const PRO_PROJECT_LIMIT = 10;
const HOBBY_LIMIT_ERROR =
  "Project limit reached. Please upgrade to Pro.";
const PRO_LIMIT_ERROR =
  "Project limit reached (10 projects on Pro).";

const HASH_ALLOC_ATTEMPTS = 32;

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function describeError(err: unknown): string {
  const e = err as { message?: unknown; cause?: unknown } | null;
  const cause = e?.cause as
    | { message?: unknown; detail?: unknown; code?: unknown }
    | undefined;
  const causeMsg =
    typeof cause?.message === "string" ? cause.message : undefined;
  const causeDetail =
    typeof cause?.detail === "string" ? cause.detail : undefined;
  const causeCode = typeof cause?.code === "string" ? cause.code : undefined;
  if (causeMsg) {
    const parts = [causeMsg];
    if (causeDetail) parts.push(causeDetail);
    if (causeCode) parts.push(`(pg ${causeCode})`);
    return parts.join(" — ");
  }
  if (typeof e?.message === "string") return e.message;
  return String(err);
}

/**
 * Pick a 7-hex hash such that no catalog row already uses this `(slug, hash)` pair (Docker stack
 * names are `flux-{hash}-{slug}-*` and must be unique on the engine).
 */
async function allocateUniqueProjectHash(
  db: ReturnType<typeof getDb>,
  slug: string,
): Promise<string | null> {
  for (let i = 0; i < HASH_ALLOC_ATTEMPTS; i++) {
    const hash = generateProjectHash();
    const clash = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.slug, slug), eq(projects.hash, hash)))
      .limit(1);
    if (clash.length === 0) return hash;
  }
  return null;
}

/**
 * POST /api/cli/v1/create
 * Authorization: Bearer flx_live_…
 * Body: `{ "name": string, "stripSupabaseRestPrefix"?: boolean, "mode"?: "v1_dedicated" | "v2_shared" }` — defaults by plan when omitted
 *
 * Order: validate → limits → allocate hash → **Docker provision** → **DB insert** only on success.
 * If insert fails after provision, nuke containers (same ghost-stack rollback as session POST).
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

  let stripSupabaseRestPrefix: boolean | undefined;
  if (
    "stripSupabaseRestPrefix" in body &&
    typeof (body as { stripSupabaseRestPrefix?: unknown })
      .stripSupabaseRestPrefix === "boolean"
  ) {
    stripSupabaseRestPrefix = (body as { stripSupabaseRestPrefix: boolean })
      .stripSupabaseRestPrefix;
  }

  let requestedMode: "v1_dedicated" | "v2_shared" | undefined;
  if ("mode" in body) {
    const mode = (body as { mode?: unknown }).mode;
    if (mode !== "v1_dedicated" && mode !== "v2_shared") {
      return jsonError('Expected "mode" to be "v1_dedicated" or "v2_shared"', 400);
    }
    requestedMode = mode;
  }

  let slug: string;
  try {
    slug = slugifyProjectName(rawName);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 400);
  }

  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.userId, auth.userId), eq(projects.slug, slug)));
  if (existing.length > 0) {
    return jsonError("You already have a project with this name.", 409);
  }

  const [{ n: projectCount }] = await db
    .select({ n: count() })
    .from(projects)
    .where(eq(projects.userId, auth.userId));

  const [userRow] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, auth.userId));

  const plan: "hobby" | "pro" =
    userRow?.plan === "pro" ? "pro" : "hobby";

  if (plan === "hobby" && projectCount >= HOBBY_PROJECT_LIMIT) {
    return jsonError(HOBBY_LIMIT_ERROR, 403);
  }
  if (plan === "pro" && projectCount >= PRO_PROJECT_LIMIT) {
    return jsonError(PRO_LIMIT_ERROR, 403);
  }

  const modePolicy = resolveCreateModeForPlan({ requestedMode, plan });
  if (!modePolicy.ok) {
    return jsonError(modePolicy.message, 403);
  }

  const projectHash = await allocateUniqueProjectHash(db, slug);
  if (projectHash === null) {
    return jsonError(
      "Could not allocate a unique project hash; retry the request.",
      503,
    );
  }

  const pm = getProjectManager();
  const tenantId = crypto.randomUUID();
  const mode: "v1_dedicated" | "v2_shared" = modePolicy.mode;
  let project: Awaited<ReturnType<typeof dispatchProvisionProject>>;
  try {
    project = await dispatchProvisionProject({
      mode,
      projectName: rawName,
      projectHash,
      tenantId,
      projectManager: pm,
      ...(stripSupabaseRestPrefix !== undefined
        ? { stripSupabaseRestPrefix }
        : {}),
      isProduction: process.env.NODE_ENV === "production",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Invalid project name")) {
      return jsonError(message, 400);
    }
    return jsonError(message, 500);
  }

  try {
    const [dbRow] = await db
      .insert(projects)
      .values({
        name: project.name,
        slug: project.slug,
        hash: project.hash,
        id: tenantId,
        userId: auth.userId,
        mode,
      })
      .returning({ id: projects.id });
    try {
      await probeSingleProject(dbRow.id);
    } catch (probeErr: unknown) {
      console.error(
        "[flux] cli create: immediate mesh probe failed (non-fatal):",
        probeErr,
      );
    }
  } catch (err: unknown) {
    await project.cleanupOnFailure();
    const message = describeError(err);
    console.error(
      `[flux] cli create: projects.insert failed after provision slug=${project.slug} hash=${project.hash}: ${message}`,
      err,
    );
    return jsonError(message, 500);
  }

  const summary: FluxProjectSummary = {
    slug: project.slug,
    hash: project.hash,
    status: "running",
    apiUrl: project.apiUrl,
  };

  const payload = {
    summary,
    secrets: project.secrets,
  };

  return Response.json(payload, {
    status: 201,
    headers: { "Cache-Control": "private, no-store" },
  });
}

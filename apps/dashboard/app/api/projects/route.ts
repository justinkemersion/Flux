import { and, count, eq } from "drizzle-orm";
import { auth } from "@/src/lib/auth";
import { projects, users } from "@/src/db/schema";
import { fluxApiUrlForSlug, slugifyProjectName } from "@flux/core";
import { getDb, initSystemDb } from "@/src/lib/db";
import { probeSingleProject } from "@/src/lib/fleet-monitor";
import { getProjectManager } from "@/src/lib/flux";

export const runtime = "nodejs";

const HOBBY_PROJECT_LIMIT = 2;
const PRO_PROJECT_LIMIT = 10;
const HOBBY_LIMIT_ERROR =
  "Project limit reached. Please upgrade to Pro.";
const PRO_LIMIT_ERROR =
  "Project limit reached (10 projects on Pro).";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * Unwrap the innermost error message so Postgres/Drizzle errors don't get reported as the opaque
 * `"Failed query: insert into ..."` envelope. Drizzle hangs the real `pg.DatabaseError`
 * (code, detail, constraint) on `.cause`; surface that so operators can tell a foreign-key
 * violation from a duplicate-key collision.
 */
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

export async function GET(): Promise<Response> {
  try {
    const session = await auth();
    if (!session?.user?.id) return jsonError("Unauthorized", 401);

    await initSystemDb();
    const db = getDb();
    const pm = getProjectManager();

    const [userRow] = await db
      .select({ plan: users.plan })
      .from(users)
      .where(eq(users.id, session.user.id));

    const plan: "hobby" | "pro" =
      userRow?.plan === "pro" ? "pro" : "hobby";

    const userProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.userId, session.user.id));

    let summaries: Awaited<ReturnType<typeof pm.getProjectSummariesForUser>>;
    try {
      summaries = await pm.getProjectSummariesForUser(session.user.id, {
        loadSlugRefsForUser: async (userId) =>
          db
            .select({ slug: projects.slug, hash: projects.hash })
            .from(projects)
            .where(eq(projects.userId, userId)),
        isProduction: process.env.NODE_ENV === "production",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonError(`Docker status unavailable: ${msg}`, 503);
    }
    const summaryBySlug = new Map(summaries.map((s) => [s.slug, s]));

    const projectsPayload = userProjects.map((p) => {
      const s = summaryBySlug.get(p.slug);
      const createdAt =
        p.createdAt instanceof Date
          ? p.createdAt.toISOString()
          : p.createdAt;
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        hash: p.hash,
        status: s?.status ?? "missing",
        apiUrl:
          s?.apiUrl ??
          fluxApiUrlForSlug(
            p.slug,
            p.hash,
            process.env.NODE_ENV === "production",
          ),
        createdAt,
        healthStatus: p.healthStatus ?? null,
        lastHeartbeatAt: p.lastHeartbeatAt
          ? p.lastHeartbeatAt.toISOString()
          : null,
      };
    });

    return Response.json({ projects: projectsPayload, plan });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[flux] GET /api/projects failed:", err);
    return jsonError(
      `Projects API error: ${message}. If the control plane or Docker is still starting, retry in a few seconds.`,
      500,
    );
  }
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

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

  let customJwtSecret: string | undefined;
  if (
    "customJwtSecret" in body &&
    typeof (body as { customJwtSecret?: unknown }).customJwtSecret === "string"
  ) {
    const s = (body as { customJwtSecret: string }).customJwtSecret.trim();
    if (s.length > 0) customJwtSecret = s;
  }

  let stripSupabaseRestPrefix: boolean | undefined;
  if (
    "stripSupabaseRestPrefix" in body &&
    typeof (body as { stripSupabaseRestPrefix?: unknown })
      .stripSupabaseRestPrefix === "boolean"
  ) {
    stripSupabaseRestPrefix = (body as { stripSupabaseRestPrefix: boolean })
      .stripSupabaseRestPrefix;
  }

  await initSystemDb();
  const db = getDb();
  const pm = getProjectManager();

  let slug: string;
  try {
    slug = slugifyProjectName(rawName);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 400);
  }

  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(eq(projects.userId, session.user.id), eq(projects.slug, slug)),
    );
  if (existing.length > 0) {
    return jsonError("You already have a project with this name.", 409);
  }

  const [{ n: projectCount }] = await db
    .select({ n: count() })
    .from(projects)
    .where(eq(projects.userId, session.user.id));

  const [userRow] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, session.user.id));

  const plan: "hobby" | "pro" =
    userRow?.plan === "pro" ? "pro" : "hobby";

  if (plan === "hobby" && projectCount >= HOBBY_PROJECT_LIMIT) {
    return jsonError(HOBBY_LIMIT_ERROR, 403);
  }
  if (plan === "pro" && projectCount >= PRO_PROJECT_LIMIT) {
    return jsonError(PRO_LIMIT_ERROR, 403);
  }

  let project: Awaited<ReturnType<typeof pm.provisionProject>>;
  try {
    project = await pm.provisionProject(rawName, {
      ...(customJwtSecret ? { customJwtSecret } : {}),
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
    const [dbProject] = await db
      .insert(projects)
      .values({
        name: project.name,
        slug: project.slug,
        hash: project.hash,
        userId: session.user.id,
      })
      .returning();

    try {
      await probeSingleProject(dbProject.id);
    } catch (probeErr: unknown) {
      console.error(
        "[flux] projects POST: immediate mesh probe failed (non-fatal):",
        probeErr,
      );
    }

    return Response.json({
      ownerId: session.user.id,
      project: {
        id: dbProject.id,
        name: dbProject.name,
        slug: dbProject.slug,
        apiUrl: project.apiUrl,
        stripSupabaseRestPrefix: project.stripSupabaseRestPrefix,
        createdAt: dbProject.createdAt,
      },
    });
  } catch (err: unknown) {
    // Ghost-container rollback: the Docker stack came up but the catalog insert failed.
    // Tear down the just-provisioned containers + volume so they do not leak.
    await pm
      .nukeContainersOnly(project.slug, project.hash)
      .catch(() => undefined);
    const message = describeError(err);
    console.error(
      `[flux] projects.insert failed after provisioning slug=${project.slug} hash=${project.hash}: ${message}`,
      err,
    );
    return jsonError(message, 500);
  }
}

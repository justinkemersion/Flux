import { count, eq } from "drizzle-orm";
import { auth } from "@/src/lib/auth";
import { projects, users } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";
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

export async function GET(): Promise<Response> {
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

  const slugs = userProjects.map((p) => p.slug);
  let dockerSummaries: Awaited<
    ReturnType<typeof pm.getProjectSummariesForSlugs>
  >;
  try {
    dockerSummaries = await pm.getProjectSummariesForSlugs(slugs);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(`Docker status unavailable: ${msg}`, 503);
  }
  const dockerBySlug = new Map(dockerSummaries.map((d) => [d.slug, d]));

  const projectsPayload = userProjects.map((p) => {
    const docker = dockerBySlug.get(p.slug);
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      status: docker?.status ?? "missing",
      apiUrl: docker?.apiUrl ?? `http://${p.slug}.flux.localhost`,
      createdAt: p.createdAt,
    };
  });

  return Response.json({ projects: projectsPayload, plan });
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

  try {
    const project = await pm.provisionProject(rawName, {
      ...(customJwtSecret ? { customJwtSecret } : {}),
      ...(stripSupabaseRestPrefix !== undefined
        ? { stripSupabaseRestPrefix }
        : {}),
    });

    const [dbProject] = await db
      .insert(projects)
      .values({
        name: project.name,
        slug: project.slug,
        userId: session.user.id,
      })
      .returning();

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
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("already exists") ||
      message.includes("Invalid project name")
    ) {
      return jsonError(message, 409);
    }
    return jsonError(message, 500);
  }
}

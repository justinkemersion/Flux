import { and, eq } from "drizzle-orm";
import {
  deriveTenantPostgresPasswordFromSecret,
  fluxApiUrlForSlug,
  fluxApiUrlForV2Shared,
} from "@flux/core";
import type { NextRequest } from "next/server";
import { auth } from "@/src/lib/auth";
import { projects } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getProjectManager } from "@/src/lib/flux";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

type PasswordSource = "container" | "derived" | "unavailable";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * GET /api/projects/[slug]/manifest
 * Public PostgREST URL and Postgres superuser material for the mesh readout
 * (password from running container when possible, else HMAC-derived when dev secret is set).
 */
export async function GET(
  _req: NextRequest,
  ctx: Ctx,
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const { slug } = await ctx.params;

  await initSystemDb();
  const db = getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.slug, slug), eq(projects.userId, session.user.id)))
    .limit(1);
  if (!project) {
    return jsonError("Project not found", 404);
  }

  const isProd = process.env.NODE_ENV === "production";
  const apiUrl =
    project.mode === "v2_shared"
      ? fluxApiUrlForV2Shared(project.slug, project.hash, isProd)
      : fluxApiUrlForSlug(project.slug, project.hash, isProd);

  if (project.mode === "v2_shared") {
    return Response.json({
      mode: "v2_shared" as const,
      apiUrl,
      postgresPassword: "",
      passwordSource: "unavailable" as PasswordSource,
    });
  }

  const pm = getProjectManager();
  let postgresPassword: string;
  let passwordSource: PasswordSource = "unavailable";
  try {
    postgresPassword = await pm.getPostgresSuperuserPassword(
      project.slug,
      project.hash,
    );
    passwordSource = "container";
  } catch {
    const sec =
      process.env.FLUX_PROJECT_PASSWORD_SECRET?.trim() ||
      process.env.FLUX_DEV_POSTGRES_PASSWORD?.trim();
    if (sec) {
      postgresPassword = deriveTenantPostgresPasswordFromSecret(
        sec,
        project.hash,
        project.slug,
      );
      passwordSource = "derived";
    } else {
      postgresPassword = "";
    }
  }

  return Response.json({
    mode: (project.mode ?? "v1_dedicated") as "v1_dedicated" | "v2_shared",
    apiUrl,
    postgresPassword,
    passwordSource,
  });
}

import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { FLUX_PROJECT_HASH_HEX_LEN } from "@flux/core";
import { projects } from "@/src/db/schema";
import {
  authenticateCliApiKey,
  extractBearerToken,
} from "@/src/lib/cli-api-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getProjectManager } from "@/src/lib/flux";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ hash: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function isValidHash(h: string): boolean {
  return (
    h.length === FLUX_PROJECT_HASH_HEX_LEN && /^[a-f0-9]+$/u.test(h)
  );
}

function parseBool(v: string | null): boolean {
  if (!v) return false;
  const n = v.trim().toLowerCase();
  return n === "1" || n === "true" || n === "yes";
}

function dumpTimestamp(d = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/**
 * GET /api/cli/v1/projects/:hash/dump
 * Query:
 *  - schemaOnly=1|true
 *  - dataOnly=1|true
 *  - clean=1|true
 *  - publicOnly=1|true
 */
export async function GET(req: Request, context: Ctx): Promise<Response> {
  await initSystemDb();
  const db = getDb();
  const secret = extractBearerToken(req.headers.get("authorization"));
  const auth = await authenticateCliApiKey(db, secret);
  if (!auth) {
    return jsonError("Unauthorized", 401);
  }

  const { hash: rawHash } = await context.params;
  const hash = (rawHash ?? "").trim().toLowerCase();
  if (!isValidHash(hash)) {
    return jsonError(
      `hash in path must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-char hex id`,
      400,
    );
  }

  const [project] = await db
    .select({ slug: projects.slug, hash: projects.hash })
    .from(projects)
    .where(and(eq(projects.userId, auth.userId), eq(projects.hash, hash)))
    .limit(1);
  if (!project) {
    return jsonError("Project not found", 404);
  }

  const url = new URL(req.url);
  const schemaOnly = parseBool(url.searchParams.get("schemaOnly"));
  const dataOnly = parseBool(url.searchParams.get("dataOnly"));
  if (schemaOnly && dataOnly) {
    return jsonError("schemaOnly and dataOnly cannot both be true", 400);
  }
  const clean = parseBool(url.searchParams.get("clean"));
  const publicOnly = parseBool(url.searchParams.get("publicOnly"));

  const pm = getProjectManager();
  let stream: Readable;
  try {
    stream = await pm.getProjectDumpStream(project.slug, project.hash, {
      schemaOnly,
      dataOnly,
      clean,
      publicOnly,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found|not running/i.test(msg)) {
      return jsonError(msg, 400);
    }
    return jsonError(msg, 500);
  }

  const filename = `${project.slug}-${dumpTimestamp()}.sql`;
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": "application/sql; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

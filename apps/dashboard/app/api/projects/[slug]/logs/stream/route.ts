import { and, eq } from "drizzle-orm";
import { FLUX_PROJECT_HASH_HEX_LEN } from "@flux/core";
import { projects } from "@/src/db/schema";
import { auth } from "@/src/lib/auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getProjectManager } from "@/src/lib/flux";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ slug: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function isValidHash(h: string): boolean {
  return (
    h.length === FLUX_PROJECT_HASH_HEX_LEN && /^[a-f0-9]+$/u.test(h)
  );
}

/**
 * GET /api/projects/[slug]/logs/stream?hash=…&service=api|db
 * Session cookie auth (dashboard). Same SSE shape as /api/cli/v1/logs.
 */
export async function GET(
  req: Request,
  ctx: Ctx,
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }

  const { slug } = await ctx.params;
  const u = new URL(req.url);
  const hash = (u.searchParams.get("hash") ?? "").trim().toLowerCase();
  const serviceRaw = (u.searchParams.get("service") ?? "api")
    .trim()
    .toLowerCase();
  if (!isValidHash(hash)) {
    return jsonError(
      `hash must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-char lowercase hex id`,
      400,
    );
  }
  if (serviceRaw !== "api" && serviceRaw !== "db") {
    return jsonError("service must be api or db", 400);
  }
  const service = serviceRaw as "api" | "db";

  await initSystemDb();
  const db = getDb();
  const owned = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.userId, session.user.id),
        eq(projects.slug, slug),
        eq(projects.hash, hash),
      ),
    )
    .limit(1);
  if (owned.length === 0) {
    return jsonError("Project not found", 404);
  }

  const pm = getProjectManager();
  const enc = new TextEncoder();
  let logReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        let logStream: ReadableStream<Uint8Array> | null = null;
        try {
          logStream = await pm.getContainerLogs(slug, hash, service, {
            signal: req.signal,
            tail: 500,
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          const payload = JSON.stringify({ error: msg });
          controller.enqueue(enc.encode(`data: ${payload}\n\n`));
          try {
            controller.close();
          } catch {
            /* */
          }
          return;
        }
        logReader = logStream.getReader();
        const dec = new TextDecoder();
        let lineBuf = "";
        try {
          while (true) {
            const { done, value } = await logReader.read();
            if (done) {
              break;
            }
            lineBuf += dec.decode(value, { stream: true });
            const lines = lineBuf.split("\n");
            lineBuf = lines.pop() ?? "";
            for (const line of lines) {
              const payload = JSON.stringify({ line });
              controller.enqueue(enc.encode(`data: ${payload}\n\n`));
            }
          }
          if (lineBuf.length > 0) {
            controller.enqueue(
              enc.encode(`data: ${JSON.stringify({ line: lineBuf })}\n\n`),
            );
          }
          try {
            controller.close();
          } catch {
            /* */
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          try {
            controller.enqueue(
              enc.encode(`data: ${JSON.stringify({ error: msg })}\n\n`),
            );
          } catch {
            /* */
          }
          try {
            controller.error(
              e instanceof Error ? e : new Error(String(e)),
            );
          } catch {
            try {
              controller.close();
            } catch {
              /* */
            }
          }
        } finally {
          try {
            await logReader?.cancel();
          } catch {
            /* */
          }
          logReader = null;
        }
      })();
    },
    async cancel() {
      try {
        await logReader?.cancel();
      } catch {
        /* */
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

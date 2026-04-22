import { and, eq } from "drizzle-orm";
import { FLUX_PROJECT_HASH_HEX_LEN } from "@flux/core";
import { projects } from "@/src/db/schema";
import { authenticateCliApiKey, extractBearerToken } from "@/src/lib/cli-api-auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getProjectManager } from "@/src/lib/flux";

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function isValidHash(h: string): boolean {
  return (
    h.length === FLUX_PROJECT_HASH_HEX_LEN && /^[a-f0-9]+$/u.test(h)
  );
}

/**
 * GET /api/cli/v1/logs?slug=&hash=&service=api|db
 * Authorization: Bearer flx_live_…
 * Response: `text/event-stream` with `data: {"line":"…"}\n\n` and optional `data: {"error":"…"}\n\n`
 */
export async function GET(req: Request): Promise<Response> {
  await initSystemDb();
  const db = getDb();
  const secret = extractBearerToken(req.headers.get("authorization"));
  const auth = await authenticateCliApiKey(db, secret);
  if (!auth) {
    return jsonError("Unauthorized", 401);
  }

  const u = new URL(req.url);
  const slug = (u.searchParams.get("slug") ?? "").trim();
  const hash = (u.searchParams.get("hash") ?? "").trim().toLowerCase();
  const serviceRaw = (u.searchParams.get("service") ?? "api")
    .trim()
    .toLowerCase();
  if (!slug) {
    return jsonError("Missing required query: slug", 400);
  }
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

  const owned = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.userId, auth.userId),
        eq(projects.slug, slug),
        eq(projects.hash, hash),
      ),
    )
    .limit(1);
  if (owned.length === 0) {
    return jsonError("Project not found for this API key", 404);
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

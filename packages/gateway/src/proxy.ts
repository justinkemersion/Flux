import type { Context } from "hono";
import { env } from "./env.ts";
import type { TenantResolution } from "./types.ts";

/**
 * Headers that must never be forwarded between hops.
 * RFC 7230 §6.1 + de-facto HTTP/1.1 proxy conventions.
 * These are stripped from both the incoming request and the upstream response.
 */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "proxy-authorization",
  "proxy-authenticate",
]);

/**
 * Forwards an incoming Hono request to the PostgREST pool.
 *
 * - Preserves method, path, query string, and all non-hop-by-hop headers.
 *   content-type, content-length, and set-cookie are explicitly preserved
 *   by the allow-all-except-hop-by-hop approach.
 * - Replaces `Authorization` with the gateway-minted JWT (invariant 3).
 * - Adds `x-forwarded-host` and `x-tenant-id` for debugging.
 * - Streams request body as a pass-through ReadableStream — never buffers.
 * - Streams upstream response body back to the client — never buffers.
 * - Strips hop-by-hop headers from the upstream response before returning.
 * - Enforces an AbortController timeout (FLUX_POSTGREST_TIMEOUT_MS, default 8s)
 *   to prevent gateway thread pileups when PostgREST hangs.
 */
export async function proxyRequest(
  c: Context,
  jwt: string,
  tenant: TenantResolution,
): Promise<Response> {
  const url = new URL(c.req.url);
  const poolUrl: string = env.FLUX_POSTGREST_POOL_URL;
  const upstream = new URL(url.pathname + url.search, poolUrl);

  // --- Forward headers (strip hop-by-hop, strip host) ---
  const reqHeaders = new Headers();
  for (const [name, value] of c.req.raw.headers.entries()) {
    if (name.toLowerCase() === "host") continue;
    if (HOP_BY_HOP.has(name.toLowerCase())) continue;
    reqHeaders.set(name, value);
  }
  // Inject gateway-controlled headers (override anything the client sent)
  reqHeaders.set("authorization", `Bearer ${jwt}`);
  reqHeaders.set("x-forwarded-host", url.hostname);
  reqHeaders.set("x-tenant-id", tenant.tenantId);

  // --- Body: pass-through stream, never buffer ---
  const hasBody = c.req.method !== "GET" && c.req.method !== "HEAD";

  const timeoutMs: number = env.FLUX_POSTGREST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const upstreamRes = await fetch(upstream.toString(), {
      method: c.req.method,
      headers: reqHeaders,
      body: hasBody ? c.req.raw.body : undefined,
      signal: controller.signal,
      // Node 18+ requires duplex:"half" when forwarding a streaming body
      ...(hasBody ? { duplex: "half" as const } : {}),
    } as RequestInit);

    // --- Response headers: strip hop-by-hop from upstream response ---
    // content-type, content-length, set-cookie, etc. are preserved because
    // the allow-all-except-hop-by-hop set covers them.
    const resHeaders = new Headers();
    for (const [name, value] of upstreamRes.headers.entries()) {
      if (HOP_BY_HOP.has(name.toLowerCase())) continue;
      resHeaders.set(name, value);
    }

    // Stream response body — no buffering
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: resHeaders,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return Response.json({ error: "upstream timeout" }, { status: 504 });
    }
    throw err;
  } finally {
    // Always cancel the timeout to prevent dangling timers under load
    clearTimeout(timer);
  }
}

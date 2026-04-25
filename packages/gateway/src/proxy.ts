import type { Context } from "hono";
import { env } from "./env.ts";
import type { TenantResolution } from "./types.ts";

/**
 * Forwards an incoming Hono request to the PostgREST pool.
 *
 * - Preserves method, path, query string, body, and original headers.
 * - Replaces `Authorization` with the gateway-minted JWT (invariant 3).
 * - Adds `x-forwarded-host` and `x-tenant-id` for debugging.
 * - Streams the upstream response back to the client.
 * - Enforces an AbortController timeout to prevent gateway pileups when
 *   PostgREST hangs (FLUX_POSTGREST_TIMEOUT_MS, default 8s).
 */
export async function proxyRequest(
  c: Context,
  jwt: string,
  tenant: TenantResolution,
): Promise<Response> {
  const url = new URL(c.req.url);
  const poolUrl: string = env.FLUX_POSTGREST_POOL_URL;
  const upstream = new URL(url.pathname + url.search, poolUrl);

  // Clone and sanitize headers — strip hop-by-hop headers
  const headers = new Headers();
  for (const [name, value] of c.req.raw.headers.entries()) {
    const lower = name.toLowerCase();
    if (
      lower === "host" ||
      lower === "connection" ||
      lower === "keep-alive" ||
      lower === "transfer-encoding" ||
      lower === "upgrade" ||
      lower === "te" ||
      lower === "trailer" ||
      lower === "proxy-authorization" ||
      lower === "proxy-authenticate"
    ) {
      continue;
    }
    headers.set(name, value);
  }

  // Inject gateway-controlled headers
  headers.set("authorization", `Bearer ${jwt}`);
  headers.set("x-forwarded-host", url.hostname);
  headers.set("x-tenant-id", tenant.tenantId);

  const timeoutMs: number = env.FLUX_POSTGREST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const hasBody = c.req.method !== "GET" && c.req.method !== "HEAD";
    const upstreamRes = await fetch(upstream.toString(), {
      method: c.req.method,
      headers,
      body: hasBody ? c.req.raw.body : undefined,
      signal: controller.signal,
      // Node 18+ requires duplex when body is a ReadableStream
      ...(hasBody ? { duplex: "half" as const } : {}),
    } as RequestInit);

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: upstreamRes.headers,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return Response.json({ error: "upstream timeout" }, { status: 504 });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

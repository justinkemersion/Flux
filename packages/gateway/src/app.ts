import { Hono } from "hono";
import { resolveTenant, type CacheSource } from "./tenant-resolver.ts";
import { acquireRateSlot } from "./rate-limiter.ts";
import { mintJwt } from "./jwt-issuer.ts";
import { trackActivity } from "./activity-tracker.ts";
import { proxyRequest } from "./proxy.ts";
import { pingDb } from "./db.ts";
import { getRedis } from "./redis.ts";

export function createApp(): Hono {
  const app = new Hono();

  // ------------------------------------------------------------------ Health
  app.get("/health", async (c) => {
    const dbUp = await pingDb();
    const redisClient = getRedis();

    let redisStatus: "up" | "down" | null = null;
    if (redisClient) {
      try {
        await redisClient.ping();
        redisStatus = "up";
      } catch {
        redisStatus = "down";
      }
    }

    const ok = dbUp;
    return c.json(
      {
        ok,
        db: dbUp ? "up" : "down",
        redis: redisStatus,
      },
      ok ? 200 : 503,
    );
  });

  // ---------------------------------------------------------------- Proxy all
  app.all("*", async (c) => {
    const start = Date.now();
    const rawHost = c.req.header("host") ?? "";

    // 1. Resolve tenant
    const resolved = await resolveTenant(rawHost).catch((err) => {
      console.error("[gateway] tenant resolution error:", err);
      return null;
    });

    if (!resolved) {
      log({
        host: rawHost,
        tenantId: null,
        mode: null,
        status: 404,
        start,
        rateLimited: false,
        cache: null,
      });
      return c.json({ error: "tenant not found" }, 404);
    }

    const { resolution: tenant, cacheSource } = resolved;

    // 2. Mode check — fail-closed: only v2_shared is routed through this gateway.
    // Any other value (including unknown future modes) is rejected with 502 rather
    // than accidentally proxied, preventing unintended cross-tenant exposure.
    if (tenant.mode !== "v2_shared") {
      // TODO: optional v1 routing support via proxy to the dedicated API container.
      log({
        host: rawHost,
        tenantId: tenant.tenantId,
        mode: tenant.mode,
        status: 502,
        start,
        rateLimited: false,
        cache: cacheSource,
      });
      return c.json(
        {
          error: `project mode "${tenant.mode}" is not routed through this gateway`,
        },
        502,
      );
    }

    // 3. Rate limit
    const allowed = await acquireRateSlot(tenant.tenantId);
    if (!allowed) {
      log({
        host: rawHost,
        tenantId: tenant.tenantId,
        mode: tenant.mode,
        status: 429,
        start,
        rateLimited: true,
        cache: cacheSource,
      });
      return c.json({ error: "rate limit exceeded" }, 429);
    }

    // 4. Mint JWT
    const jwt = await mintJwt(tenant);

    // 5. Activity tracking — fire-and-forget; never awaited
    trackActivity(tenant.tenantId);

    // 6. Proxy
    try {
      const res = await proxyRequest(c, jwt, tenant);
      log({
        host: rawHost,
        tenantId: tenant.tenantId,
        mode: tenant.mode,
        status: res.status,
        start,
        rateLimited: false,
        cache: cacheSource,
      });
      return res;
    } catch (err) {
      console.error("[gateway] proxy error:", err);
      log({
        host: rawHost,
        tenantId: tenant.tenantId,
        mode: tenant.mode,
        status: 502,
        start,
        rateLimited: false,
        cache: cacheSource,
      });
      return c.json({ error: "upstream error" }, 502);
    }
  });

  return app;
}

// ------------------------------------------------------------------ Logging

interface LogEntry {
  host: string;
  tenantId: string | null;
  mode: string | null;
  status: number;
  start: number;
  rateLimited: boolean;
  cache: CacheSource;
}

function log({
  host,
  tenantId,
  mode,
  status,
  start,
  rateLimited,
  cache,
}: LogEntry): void {
  if (process.env.NODE_ENV === "test") return;
  console.log(
    JSON.stringify({
      host,
      tenantId,
      mode,
      status,
      duration_ms: Date.now() - start,
      rate_limited: rateLimited,
      cache,
    }),
  );
}

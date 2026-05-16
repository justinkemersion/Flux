import { FLUX_GATEWAY_DRAINING_MIGRATION_STATUS } from "@flux/core/migration-status";
import { Hono } from "hono";
import {
  resolveTenant,
  fetchProjectJwtSecret,
  type CacheSource,
} from "./tenant-resolver.ts";
import { acquireRateSlot } from "./rate-limiter.ts";
import { mintBridgeJwt, mintBridgedTenantJwt, mintJwt } from "./jwt-issuer.ts";
import { trackActivity } from "./activity-tracker.ts";
import { proxyRequest } from "./proxy.ts";
import { pingDb } from "./db.ts";
import { getRedis } from "./redis.ts";
import { absorbStaticAssets } from "./static-asset-filter.ts";
import { botFilterMiddleware } from "./bot-filter.ts";
import logger from "./logger.ts";
import {
  AdaptiveInflightLimiter,
  FixedInflightLimiter,
  type InflightLimiter,
} from "./inflight-limiter.ts";
import { env } from "./env.ts";

export function createApp(): Hono {
  const app = new Hono();

  /**
   * Upstream concurrency semaphore.
   *
   * Without a cap, 10k concurrent slow PostgREST queries queue up in undici,
   * exhaust the pg pool, and eventually crash the process.  Above MAX_INFLIGHT
   * we return 503 immediately — shedding load at the gateway is far less
   * destructive than cascading failures downstream.
   *
   * Tune upward when PostgREST / PgBouncer capacity warrants it.
   */
  const limiter: InflightLimiter = env.FLUX_GATEWAY_ADAPTIVE_INFLIGHT
    ? new AdaptiveInflightLimiter({
        initialCap: env.FLUX_GATEWAY_MAX_INFLIGHT,
        minCap: env.FLUX_GATEWAY_ADAPTIVE_MIN_INFLIGHT,
        hardMax: env.FLUX_GATEWAY_ADAPTIVE_HARD_MAX_INFLIGHT,
        targetLatencyMs: env.FLUX_GATEWAY_ADAPTIVE_TARGET_P95_MS,
        upStep: env.FLUX_GATEWAY_ADAPTIVE_UP_STEP,
        downFactor: env.FLUX_GATEWAY_ADAPTIVE_DOWN_FACTOR,
        maxSamples: env.FLUX_GATEWAY_ADAPTIVE_SAMPLE_SIZE,
      })
    : new FixedInflightLimiter(env.FLUX_GATEWAY_MAX_INFLIGHT);

  if (limiter instanceof AdaptiveInflightLimiter) {
    setInterval(() => {
      limiter.tick();
      logger.debug(
        { inflight: limiter.getCurrent(), cap: limiter.getCap() },
        "adaptive inflight limiter tick",
      );
    }, env.FLUX_GATEWAY_ADAPTIVE_TICK_MS).unref();
  }

  // ------------------------------------------------------------------ Health
  // Liveness: no DB/Redis I/O — safe for Docker HEALTHCHECK / orchestrator restarts.
  app.get("/health", (c) => c.json({ status: "ok" }, 200));

  // Readiness: DB + optional Redis; 503 when system DB is unreachable.
  app.get("/health/deep", async (c) => {
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

  // ---------------------------------------------- Static-asset / scanner absorber
  // Browser-default and scanner traffic (`/robots.txt`, `/favicon.ico`,
  // `/.well-known/*`, `/wp-admin`, `/bot-connect.js`, …) is short-circuited
  // here so it never reaches tenant resolution, the JWT issuer, or PostgREST.
  // Without this, every probe hits the DB as `relation "t_…_api.foo" does not exist`.
  // Mounted between the `/health*` routes (above) and the `app.all("*", …)`
  // proxy catchall (below) so health checks still bypass it.
  app.use("*", absorbStaticAssets);

  // ---------------------------------------------- Optional bot UA denylist
  // Off by default (FLUX_GATEWAY_BLOCK_BOT_USER_AGENTS=0).  When enabled,
  // matches a conservative regex of known scanner/SEO bots and returns 403
  // before tenant resolution.  Real client UAs (curl, axios, Go-http-client,
  // python-requests, node-fetch) are explicitly NOT in the default list.
  app.use(
    "*",
    botFilterMiddleware({
      enabled: env.FLUX_GATEWAY_BLOCK_BOT_USER_AGENTS,
      ...(env.FLUX_GATEWAY_BOT_UA_PATTERN !== undefined
        ? { pattern: env.FLUX_GATEWAY_BOT_UA_PATTERN }
        : {}),
    }),
  );

  // ---------------------------------------------------------------- Proxy all
  app.all("*", async (c) => {
    const start = Date.now();
    const rawHost = c.req.header("host") ?? "";

    // 1. Resolve tenant
    const resolved = await resolveTenant(rawHost).catch((err) => {
      logger.error({ host: rawHost, err }, "tenant resolution error");
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

    if (
      (tenant.migrationStatus ?? null) === FLUX_GATEWAY_DRAINING_MIGRATION_STATUS
    ) {
      log({
        host: rawHost,
        tenantId: tenant.tenantId,
        mode: tenant.mode,
        status: 503,
        start,
        rateLimited: false,
        cache: cacheSource,
      });
      return c.json(
        { error: "project is migrating; try again later" },
        503,
      );
    }

    // 2b. Optional inbound Bearer — verify HS256 with per-project jwt_secret (not the pool secret).
    const authz = c.req.header("authorization")?.trim();
    let downstreamJwt: string | undefined;
    if (authz?.toLowerCase().startsWith("bearer ")) {
      const token = authz.slice(7).trim();
      if (token) {
        let projectSecret = tenant.jwtSecret;
        if (projectSecret == null) {
          projectSecret = await fetchProjectJwtSecret(tenant.projectId);
        }
        if (projectSecret == null) {
          return c.json(
            {
              error:
                "project jwt_secret missing; run repair on the control plane",
            },
            503,
          );
        }
        try {
          const bridged = await mintBridgeJwt(token, projectSecret);
          downstreamJwt = await mintBridgedTenantJwt(tenant, bridged.claims);
          logger.debug(
            {
              tenant_id: tenant.tenantId,
              sub: bridged.claims.sub,
              route: c.req.path,
              auth_status: "verified",
            },
            "bridge auth verified",
          );
        } catch (err) {
          logger.debug(
            {
              tenant_id: tenant.tenantId,
              sub: null,
              route: c.req.path,
              auth_status: "rejected",
              reason: err instanceof Error ? err.message : "invalid token",
            },
            "bridge auth rejected",
          );
          return c.json({ error: "invalid or expired token" }, 401);
        }
      }
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

    // 4. Concurrency cap — shed load rather than queue and cascade
    if (!limiter.tryAcquire()) {
      log({
        host: rawHost,
        tenantId: tenant.tenantId,
        mode: tenant.mode,
        status: 503,
        start,
        rateLimited: false,
        cache: cacheSource,
      });
      return c.json(
        {
          error: "gateway overloaded, retry later",
          inflight: limiter.getCurrent(),
          cap: limiter.getCap(),
        },
        503,
      );
    }

    // 5. Mint JWT + 6. Activity tracking + 7. Proxy
    const proxyStart = Date.now();
    try {
      const jwt = downstreamJwt ?? (await mintJwt(tenant));
      trackActivity(tenant.tenantId);
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
      logger.error({ host: rawHost, tenantId: tenant.tenantId, err }, "proxy error");
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
    } finally {
      limiter.release(Date.now() - proxyStart);
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
  logger.info({
    host,
    tenantId,
    mode,
    status,
    duration_ms: Date.now() - start,
    rate_limited: rateLimited,
    cache,
  });
}

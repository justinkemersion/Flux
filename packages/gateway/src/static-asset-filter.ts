import type { MiddlewareHandler } from "hono";
import logger from "./logger.ts";

/**
 * Pre-tenant short-circuit for browser-default and scanner traffic.
 *
 * The gateway proxies every non-/health path to PostgREST, which interprets
 * the URL path as a table name.  Stray browser, crawler, and bot probes
 * (`/robots.txt`, `/favicon.ico`, `/.well-known/*`, `/wp-admin`,
 * `/bot-connect.js`, …) therefore reach the database as
 * `relation "t_<id>_api.robots.txt" does not exist` errors, polluting tenant
 * logs and consuming a real Postgres transaction per probe.
 *
 * This middleware classifies the path before tenant resolution and answers
 * directly:
 *
 * - `GET /robots.txt`                          → 200 with `Disallow: /`
 *                                                 (proactively tells crawlers
 *                                                 that the API host is not a
 *                                                 site they should index).
 * - `GET /favicon.ico` and other harmless
 *   browser-default assets                     → 204 No Content
 * - `/.well-known/*`, `/.env`, `/wp-admin`,
 *   and similar security-probe paths           → 404
 * - any path with a static-asset file
 *   extension                                  → 404
 *
 * Absorbed paths never hit the DB, the JWT issuer, the rate limiter, or the
 * upstream pool.  A single `info` log line is emitted with `action:
 * "absorbed"` so operators can see the volume without the SQL noise.
 *
 * Ordering: must be mounted in `createApp()` between the `/health*` routes
 * and the `app.all("*", …)` proxy catchall.
 */

/**
 * Browser-default asset paths that should silently return 204.
 *
 * Browsers request these on first paint of any HTML host, even when the
 * response body would never be used.  204 keeps caches and DevTools quiet
 * without forcing a body, and matches what static hosts like S3/CloudFront
 * tend to do for missing favicons.
 */
const BROWSER_DEFAULT_204_PATHS = new Set<string>([
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/apple-touch-icon-precomposed.png",
  "/site.webmanifest",
  "/browserconfig.xml",
]);

/**
 * Static-asset file extensions that PostgREST cannot legitimately serve.
 *
 * REST API paths under PostgREST never carry these suffixes (table names
 * containing dots are exceptional and would not be addressable through this
 * gateway anyway), so a 404 is correct and avoids a database round-trip.
 */
const STATIC_EXT = /\.(?:ico|png|jpe?g|gif|svg|webp|css|js|mjs|map|txt|xml|woff2?|ttf|eot)$/i;

/**
 * Path prefixes used by automated scanners and security probes.
 *
 * Every match is a clear non-API request, so we 404 without engaging tenant
 * resolution.  The list is intentionally narrow: it covers the high-volume
 * footprints we have actually seen in tenant logs (and the obvious adjacent
 * ones) without trying to be a WAF.
 */
const SCANNER_PREFIX = /^\/(?:\.well-known|\.env|\.git|wp-admin|wp-login\.php|phpmyadmin|phpMyAdmin|server-status|xmlrpc\.php|cgi-bin|admin|administrator)\b/i;

/** Distinguishable verdicts for tests and logging. */
export type AbsorbVerdict =
  | { kind: "robots" }
  | { kind: "browser_default"; path: string }
  | { kind: "scanner_prefix" }
  | { kind: "static_ext" }
  | null;

/**
 * Pure path classifier — exported so tests can exercise every branch
 * without spinning up a Hono request context.
 */
export function classifyAbsorb(path: string): AbsorbVerdict {
  if (path === "/robots.txt") return { kind: "robots" };
  if (BROWSER_DEFAULT_204_PATHS.has(path)) return { kind: "browser_default", path };
  if (SCANNER_PREFIX.test(path)) return { kind: "scanner_prefix" };
  if (STATIC_EXT.test(path)) return { kind: "static_ext" };
  return null;
}

/**
 * Body returned for `/robots.txt`.  `Disallow: /` covers every crawler that
 * obeys the standard.  The trailing newline is intentional (crawlers parse
 * line-by-line and a missing newline is occasionally mishandled).
 */
const ROBOTS_TXT_BODY = "User-agent: *\nDisallow: /\n";

/**
 * Hono middleware: short-circuits absorbed paths and falls through for
 * everything else.  Pure and stateless — safe to mount once per app.
 */
export const absorbStaticAssets: MiddlewareHandler = async (c, next) => {
  const path = new URL(c.req.url).pathname;
  const verdict = classifyAbsorb(path);
  if (!verdict) return next();

  const host = c.req.header("host") ?? "";
  logger.info(
    { host, path, action: "absorbed", reason: verdict.kind },
    "request absorbed by static-asset filter",
  );

  switch (verdict.kind) {
    case "robots":
      return c.text(ROBOTS_TXT_BODY, 200, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=86400",
      });
    case "browser_default":
      return c.body(null, 204);
    case "scanner_prefix":
    case "static_ext":
      return c.json({ error: "not found" }, 404);
  }
};

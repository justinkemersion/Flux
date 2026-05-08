import type { MiddlewareHandler } from "hono";
import logger from "./logger.ts";

/**
 * Optional User-Agent denylist for known bots and security scanners.
 *
 * Off by default.  Real Flux API traffic comes from many UAs that *look* bot-
 * like to a naive filter (`curl/8.x`, `axios/1.x`, `Go-http-client/1.1`,
 * `python-requests/2.x`, `node-fetch/3.x`), so the safe default is to leave
 * this disabled and rely on the static-asset / scanner-path absorber for
 * the noisy probes.
 *
 * Operators who actually see automated abuse (e.g. SEO crawlers hammering
 * the canonical API host) can flip this on with:
 *
 *   FLUX_GATEWAY_BLOCK_BOT_USER_AGENTS=1
 *
 * and optionally extend the regex with:
 *
 *   FLUX_GATEWAY_BOT_UA_PATTERN="MJ12bot|AhrefsBot|MyExtraBot"
 *
 * The override REPLACES the default pattern so the operator stays in
 * control of who they block.  Invalid regexes log an error and the filter
 * stays disabled (fail-open) rather than rejecting all traffic.
 */

/**
 * Conservative default denylist.
 *
 * Each entry is either a known SEO/marketing crawler that has no business
 * hitting an API host (`MJ12bot`, `AhrefsBot`, …) or a well-known offensive
 * security tool (`nikto`, `sqlmap`, …).  Real client libraries are
 * deliberately omitted.
 */
export const DEFAULT_BOT_UA_PATTERN =
  /\b(?:MJ12bot|AhrefsBot|SemrushBot|PetalBot|DotBot|YandexBot|nikto|sqlmap|wpscan|masscan|nmap|Nuclei|zgrab)\b/i;

export interface BotFilterOptions {
  enabled: boolean;
  /** When provided, REPLACES DEFAULT_BOT_UA_PATTERN.  Invalid regex → fail-open. */
  pattern?: string;
}

/**
 * Builds the bot-filter middleware.  When disabled, returns a no-op middleware
 * so the runtime cost on the hot path is a single function call.
 */
export function botFilterMiddleware(options: BotFilterOptions): MiddlewareHandler {
  if (!options.enabled) {
    return async (_c, next) => next();
  }

  let pattern = DEFAULT_BOT_UA_PATTERN;
  const rawOverride = options.pattern?.trim();
  if (rawOverride) {
    try {
      pattern = new RegExp(rawOverride, "i");
    } catch (err) {
      logger.error(
        { pattern: rawOverride, err: err instanceof Error ? err.message : err },
        "FLUX_GATEWAY_BOT_UA_PATTERN is not a valid regex; bot filter disabled (fail-open)",
      );
      return async (_c, next) => next();
    }
  }

  return async (c, next) => {
    const ua = c.req.header("user-agent") ?? "";
    if (ua && pattern.test(ua)) {
      const host = c.req.header("host") ?? "";
      logger.info(
        {
          host,
          path: new URL(c.req.url).pathname,
          ua,
          action: "ua_blocked",
        },
        "request blocked by bot UA filter",
      );
      return c.json({ error: "forbidden" }, 403);
    }
    return next();
  };
}

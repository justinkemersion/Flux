/**
 * Composable proxy helpers for Next.js 16 `proxy.ts`.
 *
 * Keeps CLI rate-limit logic unit-testable without pulling Auth.js into every test.
 */

import type { NextRequest } from "next/server";
import { cliRateLimitResponse } from "./cli-rate-limit";

/** True when the pathname is under the CLI control-plane API. */
export function isCliV1Path(pathname: string): boolean {
  return pathname.startsWith("/api/cli/v1");
}

/**
 * Apply the in-memory CLI rate limiter for `/api/cli/v1/*`.
 * Returns a 429 response when limited, otherwise `null` (continue the chain).
 */
export function applyCliRateLimitIfNeeded(req: NextRequest): Response | null {
  if (!isCliV1Path(req.nextUrl.pathname)) {
    return null;
  }
  return cliRateLimitResponse(req);
}

/** Whether a pathname would be handled by the CLI v1 matcher segment. */
export function matchesCliV1ProxyMatcher(pathname: string): boolean {
  return pathname.startsWith("/api/cli/v1/");
}

/**
 * Whether a pathname would be excluded from the broad session-gate matcher
 * (see `proxy.ts` config — `api/cli` prefix is excluded).
 */
export function isExcludedFromBroadProxyMatcher(pathname: string): boolean {
  if (pathname.startsWith("/api/cli/") || pathname === "/api/cli") {
    return true;
  }
  if (pathname.startsWith("/_next/static") || pathname.startsWith("/_next/image")) {
    return true;
  }
  if (pathname === "/favicon.ico") return true;
  if (pathname.startsWith("/install") || pathname.startsWith("/docs") || pathname.startsWith("/public")) {
    return true;
  }
  return false;
}

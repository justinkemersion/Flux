import { auth } from "@/src/lib/auth";
import { demoReadOnlyMiddleware } from "@/src/lib/demo-readonly-middleware";
import { applyCliRateLimitIfNeeded } from "@/src/lib/flux-proxy";
import { NextResponse } from "next/server";
import type { NextFetchEvent, NextMiddleware, NextRequest } from "next/server";

type AuthMiddleware = (request: NextRequest, event: NextFetchEvent) => ReturnType<NextMiddleware>;

/**
 * Next.js 16 proxy (formerly middleware).
 *
 * Must export a function named `proxy`. Next 16 refuses to build when a
 * `middleware.ts` also exists, so every edge concern belongs here.
 *
 * Important: `auth(callback)` returns a route-handler object, not middleware.
 * Use the base `auth` export for session gating; apply CLI rate limits separately.
 *
 * - Any `/api/*`: demo sessions are blocked from mutating requests first, so the
 *   guard applies to CLI routes too (they never reach the Auth.js branch below).
 * - `/api/health`: bypassed entirely (liveness + build provenance; no session, no rate limit).
 * - `/api/cli/v1/*`: rate limit → `NextResponse.next()` (Bearer auth in route handlers).
 * - Other matched paths: Auth.js `auth()` + `authorized` callback in `auth.ts`.
 */
export async function proxy(request: NextRequest, event: NextFetchEvent) {
  // Liveness and build provenance must not depend on session machinery: the deploy guard
  // probes an unrouted candidate container and `flux` probes before authenticating, and a
  // health endpoint that fails when auth config is incomplete cannot be used to diagnose that.
  if (request.nextUrl.pathname === "/api/health") {
    return NextResponse.next();
  }

  const blocked = await demoReadOnlyMiddleware(request);
  if (blocked) return blocked;

  if (request.nextUrl.pathname.startsWith("/api/cli/v1")) {
    const limited = applyCliRateLimitIfNeeded(request);
    if (limited) return limited;
    return NextResponse.next();
  }
  return (auth as unknown as AuthMiddleware)(request, event);
}

export const config = {
  matcher: [
    // Superset of the CLI pattern below, so the demo read-only guard sees every
    // API request. v1 is the only CLI version, so no CLI route changes branch.
    "/api/:path*",
    "/api/cli/v1/:path*",
    /*
     * Match all request paths except for the ones starting with:
     * - api/cli (CLI API — rate limit above; no session gate)
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - install, docs, public
     */
    "/((?!api/cli(?:/|$)|_next/static|_next/image|favicon\\.ico|install|docs|public).*)",
  ],
};

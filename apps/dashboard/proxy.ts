import { auth } from "@/src/lib/auth";
import { applyCliRateLimitIfNeeded } from "@/src/lib/flux-proxy";
import { NextResponse } from "next/server";
import type { NextFetchEvent, NextMiddleware, NextRequest } from "next/server";

type AuthMiddleware = (request: NextRequest, event: NextFetchEvent) => ReturnType<NextMiddleware>;

/**
 * Next.js 16 proxy (formerly middleware).
 *
 * Must export a function named `proxy`.
 *
 * Important: `auth(callback)` returns a route-handler object, not middleware.
 * Use the base `auth` export for session gating; apply CLI rate limits separately.
 *
 * - `/api/cli/v1/*`: rate limit → `NextResponse.next()` (Bearer auth in route handlers).
 * - Other matched paths: Auth.js `auth()` + `authorized` callback in `auth.ts`.
 */
export function proxy(request: NextRequest, event: NextFetchEvent) {
  if (request.nextUrl.pathname.startsWith("/api/cli/v1")) {
    const limited = applyCliRateLimitIfNeeded(request);
    if (limited) return limited;
    return NextResponse.next();
  }
  return (auth as unknown as AuthMiddleware)(request, event);
}

export const config = {
  matcher: [
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

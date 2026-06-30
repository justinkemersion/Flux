import { auth } from "@/src/lib/auth";
import { applyCliRateLimitIfNeeded } from "@/src/lib/flux-proxy";
import { NextResponse } from "next/server";
import type { NextFetchEvent, NextMiddleware, NextRequest } from "next/server";

type SessionProxy = (request: NextRequest, event: NextFetchEvent) => ReturnType<NextMiddleware>;

/**
 * Next.js 16 proxy (formerly middleware).
 *
 * Must export a function named `proxy` (see Next.js 16 proxy convention).
 *
 * - `/api/cli/v1/*`: fixed-window rate limiting only, then `NextResponse.next()`.
 *   Bearer auth stays in route handlers; the CLI must never hit the browser login flow.
 * - All other matched paths: Auth.js session gate via `auth()` and the `authorized`
 *   callback in `auth.ts`.
 */
const sessionProxy = auth(() => {
  // CLI paths return before sessionProxy; dashboard auth is enforced in authorized().
}) as unknown as SessionProxy;

export function proxy(request: NextRequest, event: NextFetchEvent) {
  if (request.nextUrl.pathname.startsWith("/api/cli/v1")) {
    const limited = applyCliRateLimitIfNeeded(request);
    if (limited) return limited;
    return NextResponse.next();
  }
  return sessionProxy(request, event);
}

export const config = {
  matcher: [
    "/api/cli/v1/:path*",
    /*
     * Match all request paths except for the ones starting with:
     * - api/cli (CLI API — handled by the matcher above; no session gate)
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - install, docs, public
     */
    "/((?!api/cli(?:/|$)|_next/static|_next/image|favicon\\.ico|install|docs|public).*)",
  ],
};

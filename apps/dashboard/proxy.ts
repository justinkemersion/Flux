import { auth } from "@/src/lib/auth";
import { applyCliRateLimitIfNeeded } from "@/src/lib/flux-proxy";
import type { NextFetchEvent, NextMiddleware, NextRequest } from "next/server";

type AuthMiddleware = (request: NextRequest, event: NextFetchEvent) => ReturnType<NextMiddleware>;

/**
 * Next.js 16 proxy (formerly middleware).
 *
 * Must export a function named `proxy` (see Next.js 16 proxy convention).
 *
 * - `/api/cli/v1/*`: fixed-window rate limiting, then continue (no browser login redirect).
 * - All other matched paths: Auth.js session gate via the `authorized` callback in `auth.ts`.
 */
const authMiddleware = auth((req) => {
  if (req.nextUrl.pathname.startsWith("/api/cli/v1")) {
    const limited = applyCliRateLimitIfNeeded(req);
    if (limited) return limited;
  }
}) as unknown as AuthMiddleware;

export function proxy(request: NextRequest, event: NextFetchEvent) {
  return authMiddleware(request, event);
}

export const config = {
  matcher: [
    "/api/cli/v1/:path*",
    /*
     * Match all request paths except for the ones starting with:
     * - api/cli (CLI API — rate limit handled in auth callback; session gate skipped via authorized())
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - install, docs, public
     */
    "/((?!api/cli(?:/|$)|_next/static|_next/image|favicon\\.ico|install|docs|public).*)",
  ],
};

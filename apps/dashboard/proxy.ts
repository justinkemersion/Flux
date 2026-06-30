import { auth } from "@/src/lib/auth";
import { cliRateLimitResponse } from "@/src/lib/cli-rate-limit";

/**
 * Next.js 16 proxy (formerly middleware).
 *
 * - `/api/cli/v1/*`: fixed-window rate limiting (Bearer auth stays in route handlers).
 * - Everything else: Auth.js session gate via the `authorized` callback in `auth.ts`.
 *   `/api/cli/*` is excluded from browser login redirects by returning `true` there.
 */
export default auth((req) => {
  if (req.nextUrl.pathname.startsWith("/api/cli/v1")) {
    const limited = cliRateLimitResponse(req);
    if (limited) return limited;
  }
});

export const config = {
  matcher: [
    "/api/cli/v1/:path*",
    /*
     * Match all request paths except for the ones starting with:
     * - api/cli (CLI API — rate limit handled above; session auth skipped via authorized())
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - install, docs, public
     */
    "/((?!api/cli(?:/|$)|_next/static|_next/image|favicon\\.ico|install|docs|public).*)",
  ],
};

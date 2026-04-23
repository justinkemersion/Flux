import { auth } from "@/src/lib/auth";

/**
 * Excludes /api/cli/*: those routes use Bearer `authenticateCliApiKey` and must not be redirected
 * to the browser login flow (which would return HTML to the CLI).
 */
export default auth;

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/cli (CLI API)
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - install, docs, public
     */
    // `api/cli` only — not `api/client` or other /api/* routes (use `api/cli(?:/|$)`).
    "/((?!api/cli(?:/|$)|_next/static|_next/image|favicon\\.ico|install|docs|public).*)",
  ],
};

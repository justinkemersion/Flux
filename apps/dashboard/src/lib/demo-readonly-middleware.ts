import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const READONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Demo sessions may browse the dashboard but must not mutate control-plane state. */
export async function demoReadOnlyMiddleware(
  req: NextRequest,
): Promise<Response | null> {
  if (READONLY_METHODS.has(req.method.toUpperCase())) return null;

  const path = req.nextUrl.pathname;
  if (!path.startsWith("/api/")) return null;
  if (path.startsWith("/api/auth")) return null;

  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return null;

  const token = await getToken({ req, secret });
  if (!(token as { isDemo?: boolean } | null)?.isDemo) return null;

  return NextResponse.json(
    { error: "Demo sessions are read-only." },
    { status: 403 },
  );
}

import { demoReadOnlyMiddleware } from "@/src/lib/demo-readonly-middleware";
import type { NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  const blocked = await demoReadOnlyMiddleware(req);
  if (blocked) return blocked;
}

export const config = {
  matcher: ["/api/:path*"],
};

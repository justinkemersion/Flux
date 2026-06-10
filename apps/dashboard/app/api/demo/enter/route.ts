import { NextResponse } from "next/server";
import { signIn } from "@/src/lib/auth";
import { isDemoEnabled } from "@/src/lib/demo-auth";

export const runtime = "nodejs";

/** GET /api/demo/enter — mint a demo session cookie and redirect to /projects. */
export async function GET(): Promise<Response> {
  const base = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "https://flux.vsl-base.com";
  if (!isDemoEnabled()) {
    return NextResponse.redirect(new URL("/?demo=unavailable", base));
  }
  const key = process.env.FLUX_DEMO_INTERNAL_KEY!.trim();
  await signIn("flux-demo", { key, redirectTo: "/projects" });
  return NextResponse.redirect(new URL("/projects", base));
}

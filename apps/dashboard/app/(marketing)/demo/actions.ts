"use server";

import { redirect } from "next/navigation";
import { signIn } from "@/src/lib/auth";
import { isDemoEnabled } from "@/src/lib/demo-auth";

/** Server-only: mint a read-only demo session and open /projects. */
export async function enterDemoSession(): Promise<void> {
  if (!isDemoEnabled()) {
    redirect("/?demo=unavailable");
  }
  const key = process.env.FLUX_DEMO_INTERNAL_KEY!.trim();
  await signIn("flux-demo", { key, redirectTo: "/projects" });
}

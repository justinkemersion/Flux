import type { Metadata } from "next";
import { isDemoEnabled } from "@/src/lib/demo-auth";
import { enterDemoSession } from "./actions";
import { DemoUnavailable } from "./demo-unavailable";

export const metadata: Metadata = {
  title: "Try Flux Demo — Flux",
  description:
    "Enter a read-only Flux demo session to explore the control plane with seeded projects.",
};

export default async function DemoPage() {
  if (!isDemoEnabled()) {
    return <DemoUnavailable />;
  }
  await enterDemoSession();
}

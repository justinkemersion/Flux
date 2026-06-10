import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isDemoEnabled } from "@/src/lib/demo-auth";
import { DemoUnavailable } from "./demo-unavailable";

export const metadata: Metadata = {
  title: "Try Flux Demo — Flux",
  description:
    "Enter a read-only Flux demo session to explore the control plane with seeded projects.",
};

export default function DemoPage() {
  if (!isDemoEnabled()) {
    return <DemoUnavailable />;
  }
  redirect("/api/demo/enter");
}

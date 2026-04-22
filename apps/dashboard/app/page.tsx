import { FluxLanding } from "@/src/components/flux-landing";
import { getLandingFleetShowcase } from "@/src/lib/fleet-showcase";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Flux — Deterministic Orchestration",
  description:
    "Flux infrastructure: isolated PostgreSQL and PostgREST, deterministic orchestration. flux.vsl-base.com",
};

export const dynamic = "force-dynamic";

export default async function Home() {
  const fleetShowcase = await getLandingFleetShowcase();
  return <FluxLanding fleetShowcase={fleetShowcase} />;
}

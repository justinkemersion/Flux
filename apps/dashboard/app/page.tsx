import { FluxLanding } from "@/src/components/flux-landing";
import { getFleetReliability } from "@/src/lib/fleet-monitor";
import { getLandingFleetShowcase } from "@/src/lib/fleet-showcase";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Flux — Deterministic Orchestration",
  description:
    "Flux infrastructure: isolated PostgreSQL and PostgREST, deterministic orchestration. flux.vsl-base.com",
};

export const dynamic = "force-dynamic";

export default async function Home() {
  const [fleetShowcase, reliability] = await Promise.all([
    getLandingFleetShowcase(),
    getFleetReliability(),
  ]);
  return <FluxLanding fleetShowcase={fleetShowcase} reliability={reliability} />;
}

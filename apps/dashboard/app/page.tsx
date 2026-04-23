import { FluxLanding } from "@/src/components/flux-landing";
import { getFleetReliability } from "@/src/lib/fleet-monitor";
import { getLandingFleetShowcase } from "@/src/lib/fleet-showcase";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Flux — From zero to database in one command",
  description:
    "Isolated Postgres and a REST API per project. Install the CLI, run create, and manage your stack from the terminal or dashboard.",
};

export const dynamic = "force-dynamic";

export default async function Home() {
  const [fleetShowcase, reliability] = await Promise.all([
    getLandingFleetShowcase(),
    getFleetReliability(),
  ]);
  return <FluxLanding fleetShowcase={fleetShowcase} reliability={reliability} />;
}

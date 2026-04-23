import { FluxLanding } from "@/src/components/flux-landing";
import { getFleetReliability } from "@/src/lib/fleet-monitor";
import { getLandingFleetShowcase } from "@/src/lib/fleet-showcase";
import { queryCodexAction } from "@/src/lib/actions";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Flux: The Backbone of Your Platform",
  description:
    "Enterprise-grade database infrastructure for developers who ship.",
};

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Home() {
  const [fleetShowcase, reliability] = await Promise.all([
    getLandingFleetShowcase(),
    getFleetReliability(),
  ]);
  return (
    <FluxLanding
      fleetShowcase={fleetShowcase}
      reliability={reliability}
      queryCodexAction={queryCodexAction}
    />
  );
}

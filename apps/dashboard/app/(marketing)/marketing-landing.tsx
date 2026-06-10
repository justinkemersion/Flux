import { AppShowcase } from "./components/app-showcase";
import { BuildSection } from "./components/build-section";
import { DemoPhilosophy } from "./components/demo-philosophy";
import { Hero } from "./components/hero";
import { InfrastructureSection } from "./components/infrastructure-section";
import { PlatformComparison } from "./components/platform-comparison";

export function MarketingLanding() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-16 sm:px-8 sm:py-24">
      <Hero />
      <div className="mt-24 sm:mt-32">
        <AppShowcase />
      </div>
      <div className="mt-24 sm:mt-32">
        <PlatformComparison />
      </div>
      <div className="mt-24 sm:mt-32">
        <InfrastructureSection />
      </div>
      <div className="mt-24 sm:mt-32">
        <DemoPhilosophy />
      </div>
      <div className="mt-24 sm:mt-32">
        <BuildSection />
      </div>
    </main>
  );
}

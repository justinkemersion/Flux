import { Bullets } from "./components/bullets";
import { CliSnippet } from "./components/cli-snippet";
import { FinalCTA } from "./components/final-cta";
import { Hero } from "./components/hero";
import { Lifecycle } from "./components/lifecycle";

export function MarketingLanding() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-16 text-center sm:px-8 sm:py-24">
      <Hero />
      <div className="mt-24 sm:mt-32">
        <Bullets />
      </div>
      <div className="mt-24 sm:mt-32">
        <CliSnippet />
      </div>
      <div className="mt-24 sm:mt-32">
        <Lifecycle />
      </div>
      <div className="mt-28 sm:mt-36">
        <FinalCTA />
      </div>
    </main>
  );
}

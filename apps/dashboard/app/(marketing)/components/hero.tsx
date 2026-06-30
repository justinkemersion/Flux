import { FLUX_DEMO_HREF } from "../data/landing-links";
import { primaryCtaClass, secondaryCtaClass } from "./landing-ui";

export function Hero() {
  return (
    <section
      aria-labelledby="flux-hero-heading"
      className="flex flex-col items-center text-center"
    >
      <h1
        id="flux-hero-heading"
        className="max-w-xl text-4xl font-medium leading-tight tracking-tight text-white sm:text-5xl"
        style={{ fontFamily: "var(--font-landing-headline), ui-sans-serif, system-ui, sans-serif" }}
      >
        Apps first. Infrastructure underneath.
      </h1>
      <p className="mt-8 max-w-xl text-base leading-relaxed text-zinc-400">
        Provision tenant APIs, push migrations, inspect schemas, verify backups, and give coding
        agents structured project context through CLI, dashboard, and MCP.
      </p>
      <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
        <a href="#apps" className={primaryCtaClass}>
          Explore the Apps
        </a>
        <a href={FLUX_DEMO_HREF} className={secondaryCtaClass}>
          Try Flux Demo
        </a>
      </div>
    </section>
  );
}

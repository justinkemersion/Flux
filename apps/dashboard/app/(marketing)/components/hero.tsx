import Link from "next/link";
import { GetStartedButton } from "./get-started-button";

const focusSecondary =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

const secondaryCtaClass = `inline-flex items-center justify-center rounded-md border border-zinc-600/70 bg-zinc-950/30 px-5 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:border-zinc-500 hover:bg-zinc-900/40 hover:text-zinc-200 ${focusSecondary}`;

export function Hero() {
  return (
    <section aria-labelledby="flux-hero-heading" className="flex flex-col items-center text-center">
      <h1
        id="flux-hero-heading"
        className="max-w-xl text-4xl font-medium leading-tight tracking-tight text-white sm:text-5xl"
        style={{ fontFamily: "var(--font-landing-headline), ui-sans-serif, system-ui, sans-serif" }}
      >
        PostgreSQL, ready to use.
      </h1>
      <p className="mt-8 max-w-md text-base leading-relaxed text-zinc-400">
        SQL migrations, REST APIs, and JWT-aware access
        <br />
        without building the infrastructure yourself.
      </p>
      <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
        <GetStartedButton />
        <Link href="/docs/introduction/what-is-flux" className={secondaryCtaClass}>
          Explore the Architecture
        </Link>
      </div>
    </section>
  );
}

"use client";

import Link from "next/link";
import { signIn, useSession } from "next-auth/react";

const focusPrimary =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

export function FluxLanding() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-950 text-zinc-100">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-16 text-center sm:px-8 sm:py-24">
        <section aria-labelledby="flux-hero-heading" className="flex flex-col items-center">
          <h1
            id="flux-hero-heading"
            className="font-sans text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl"
          >
            PostgreSQL, ready to use.
          </h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-zinc-400">
            A clean API over your database.
            <br />
            No setup. No abstraction.
          </p>
          <div className="mt-10">
            <LandingCtas />
          </div>
        </section>

        <section aria-labelledby="why-flux-heading" className="mt-20 sm:mt-28">
          <h2 id="why-flux-heading" className="sr-only">
            Why Flux
          </h2>
          <ul className="mx-auto flex max-w-sm flex-col items-center gap-5 text-center text-base leading-snug text-zinc-300">
            <li>No setup</li>
            <li>Clean API</li>
            <li>Upgrade when your app grows</li>
          </ul>
        </section>

        <section aria-labelledby="lifecycle-heading" className="mt-20 sm:mt-28">
          <h2 id="lifecycle-heading" className="sr-only">
            How it scales with you
          </h2>
          <p className="mx-auto max-w-md text-base leading-relaxed text-zinc-400">
            Start with a free project.
          </p>
          <p className="mx-auto mt-5 max-w-md text-base leading-relaxed text-zinc-400">
            When your app grows, move to a dedicated instance.
            <br />
            No neighbors. No rewrites.
          </p>
        </section>

        <section aria-labelledby="cta-heading" className="mt-20 sm:mt-28">
          <h2
            id="cta-heading"
            className="font-sans text-lg font-medium leading-snug text-zinc-100 sm:text-xl"
          >
            Start building on PostgreSQL today.
          </h2>
          <div className="mt-8">
            <LandingCtas />
          </div>
        </section>
      </main>
    </div>
  );
}

function LandingCtas() {
  const { status } = useSession();

  if (status === "loading") {
    return (
      <p className="text-sm text-zinc-500" aria-live="polite">
        Loading…
      </p>
    );
  }

  const primaryClass = `inline-flex items-center justify-center rounded-md bg-white px-6 py-3 text-base font-semibold text-zinc-950 transition-colors duration-200 ease-linear hover:bg-zinc-100 ${focusPrimary}`;

  if (status === "unauthenticated") {
    return (
      <button
        type="button"
        onClick={() => void signIn("github", { callbackUrl: "/projects" })}
        className={primaryClass}
      >
        Get started
      </button>
    );
  }

  return (
    <Link href="/projects" className={primaryClass}>
      Open Projects
    </Link>
  );
}

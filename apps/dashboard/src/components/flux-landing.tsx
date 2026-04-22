"use client";

import Link from "next/link";
import { signIn, useSession } from "next-auth/react";

const simplePath = [
  {
    title: "Spin up",
    body: "PostgreSQL 16 and PostgREST, ready the moment you create a project.",
  },
  {
    title: "Secure",
    body: "Deterministic auth that actually works with your stack.",
  },
  {
    title: "Interact",
    body: "A fast REST API over your database—no boilerplate.",
  },
  {
    title: "Own",
    body: "Full CLI support when you want to work locally.",
  },
] as const;

const focusable =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 dark:focus-visible:ring-zinc-500/35 dark:focus-visible:ring-offset-zinc-950";

const ctaClass = `inline-flex w-full items-center justify-center rounded-md bg-zinc-900 px-6 py-3.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-zinc-800 sm:w-auto dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 ${focusable}`;

export function FluxLanding() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-6 py-16 sm:px-8 sm:py-24">
        <section aria-labelledby="flux-hero-heading">
          <h1
            id="flux-hero-heading"
            className="text-3xl font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl sm:leading-snug"
          >
            Infrastructure that stays in your back pocket.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
            Flux gives each project its own Postgres database and a real REST API—so
            you can ship without wiring servers by hand.
          </p>
        </section>

        <section
          className="mt-14 sm:mt-16"
          aria-labelledby="simple-path-heading"
        >
          <h2
            id="simple-path-heading"
            className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-500"
          >
            The simple path
          </h2>
          <ul className="mt-6 flex flex-col gap-8">
            {simplePath.map(({ title, body }) => (
              <li key={title} className="flex gap-4">
                <span
                  className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-500"
                  aria-hidden
                />
                <div>
                  <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {title}
                  </p>
                  <p className="mt-1 text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-14 sm:mt-16">
          <DashboardCta />
        </div>
      </main>
    </div>
  );
}

function DashboardCta() {
  const { status } = useSession();

  if (status === "loading") {
    return (
      <p className="text-center text-sm text-zinc-500 dark:text-zinc-500">
        Loading…
      </p>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="flex justify-center sm:justify-start">
        <button
          type="button"
          onClick={() => void signIn("github", { callbackUrl: "/projects" })}
          className={ctaClass}
        >
          Enter Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="flex justify-center sm:justify-start">
      <Link href="/projects" className={ctaClass}>
        Enter Dashboard
      </Link>
    </div>
  );
}

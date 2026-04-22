"use client";

import Link from "next/link";
import { signIn, useSession } from "next-auth/react";

const stackRows = [
  { label: "ENGINE", value: "PostgreSQL 16-alpine." },
  { label: "INTERFACE", value: "PostgREST v12." },
  { label: "ROUTING", value: "Traefik v3 with Global Hashing." },
  { label: "SECURITY", value: "HS256 JWT (NextAuth / GitHub)." },
] as const;

const focusable =
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500";

const primaryCtaClass = `inline-flex items-center gap-1 border border-zinc-700 bg-zinc-900/50 px-5 py-2.5 font-mono text-xs tracking-[0.16em] text-zinc-400 transition-[border-color,background-color,color] hover:border-zinc-600 hover:bg-zinc-900 hover:text-zinc-300 sm:text-sm sm:tracking-[0.18em] ${focusable}`;

export function FluxLanding() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-16 sm:px-8 sm:py-20">
        <section aria-labelledby="flux-hero-heading">
          <h1
            id="flux-hero-heading"
            className="font-sans text-3xl font-extrabold leading-[1.15] tracking-tight text-zinc-400 sm:text-4xl md:text-5xl"
          >
            Instant Infrastructure.
          </h1>
          <p className="mt-5 max-w-2xl font-mono text-sm leading-relaxed text-zinc-400 sm:text-base">
            Postgres + PostgREST. Isolated, Hashed, and Deterministic. Built
            for the technical elite.
          </p>
        </section>

        <section className="mt-16 sm:mt-20" aria-labelledby="flux-stack-heading">
          <h2 id="flux-stack-heading" className="sr-only">
            Stack specification
          </h2>
          <table className="w-full border border-zinc-800 border-collapse font-mono text-sm">
            <tbody>
              {stackRows.map(({ label, value }) => (
                <tr
                  key={label}
                  className="border-b border-zinc-800 last:border-b-0"
                >
                  <th
                    scope="row"
                    className="w-[38%] py-3 pl-3 pr-4 align-top text-left text-[10px] font-normal uppercase tracking-[0.2em] text-zinc-500 sm:w-[32%] sm:py-3.5 sm:pl-4"
                  >
                    {label}
                  </th>
                  <td className="py-3 pr-3 align-top text-zinc-400 sm:py-3.5 sm:pr-4">
                    {value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="mt-16 sm:mt-20">
          <PrimaryCta />
        </div>
      </main>
    </div>
  );
}

function PrimaryCta() {
  const { status } = useSession();

  if (status === "loading") {
    return (
      <p className="font-mono text-xs text-zinc-500 [font-variant:small-caps]">
        [ LOADING ]
      </p>
    );
  }

  if (status === "unauthenticated") {
    return (
      <button
        type="button"
        onClick={() => void signIn("github")}
        className={primaryCtaClass}
      >
        <span aria-hidden className="text-zinc-500">
          [
        </span>
        INITIALIZE_SESSION
        <span aria-hidden className="text-zinc-500">
          ]
        </span>
      </button>
    );
  }

  return (
    <Link href="/projects" className={primaryCtaClass}>
      <span aria-hidden className="text-zinc-500">
        [
      </span>
      ACCESS_PROJECT_CONSOLE
      <span aria-hidden className="text-zinc-500">
        ]
      </span>
    </Link>
  );
}

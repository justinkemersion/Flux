"use client";

import { CodexQueryPanel } from "@/src/components/codex-query-panel";
import { CodeBlock } from "@/src/components/docs/code-block";
import { FleetManifest } from "@/src/components/landing/fleet-manifest";
import { ReliabilityBadge } from "@/src/components/landing/reliability-badge";
import type { queryCodexAction as QueryCodexAction } from "@/src/lib/actions";
import type { FleetShowcaseCard } from "@/src/lib/fleet-showcase";
import type { FleetReliability } from "@/src/lib/fleet-monitor";
import Link from "next/link";
import { signIn, useSession } from "next-auth/react";

const focusPrimary =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

const focusSecondary =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

const focusLink =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900";

type Props = {
  fleetShowcase: FleetShowcaseCard[];
  reliability: FleetReliability;
  queryCodexAction: typeof QueryCodexAction;
};

export function FluxLanding({ fleetShowcase, reliability, queryCodexAction }: Props) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-950 text-zinc-100">
      <div className="flux-hero-grid border-b border-zinc-800/80">
        <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:px-10 sm:py-20 md:py-24">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 max-w-3xl flex-1">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-zinc-400">
              Platform
            </p>
            <h1
              id="flux-hero-heading"
              className="mt-3 font-sans text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-5xl md:text-6xl"
            >
              From zero to database in one command
            </h1>
            <p className="mt-6 max-w-2xl font-sans text-lg leading-relaxed text-zinc-400 sm:text-xl">
              Each project gets isolated Postgres and a PostgREST API. Install
              the CLI, run <code className="text-zinc-300">flux create</code>, and
              manage stacks from here or the terminal—fast and yours.
            </p>
            <div className="mt-10">
              <LandingCtas />
            </div>
            </div>
            <ReliabilityBadge reliability={reliability} />
          </div>
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col bg-zinc-950 px-6 py-16 text-zinc-100 sm:px-10 sm:py-20">
        <FleetManifest initialShowcase={fleetShowcase} />

        <section
          className="mt-16 border-t border-zinc-800 pt-14"
          aria-labelledby="ai-codex-heading"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3 border border-emerald-900/10 bg-zinc-900/80 shadow-[0_0_24px_-8px_rgba(6,78,59,0.35)]">
            <div className="flex w-full flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-zinc-800 px-4 py-3 sm:px-5">
              <h2
                id="ai-codex-heading"
                className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-500"
                style={{ fontFamily: "var(--font-geist-mono)" }}
              >
                [ AI_CODEX_NAVIGATOR ]
              </h2>
              <p
                className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500"
                style={{ fontFamily: "var(--font-geist-mono)" }}
                aria-label="Model status online"
              >
                <span className="text-emerald-400" aria-hidden>
                  ●
                </span>
                _ONLINE_LLM_L3_8B
              </p>
            </div>
            <div className="w-full">
              <CodexQueryPanel queryAction={queryCodexAction} />
            </div>
          </div>
        </section>

        <section
          className="mt-16 border-t border-zinc-800 pt-14"
          aria-labelledby="doc-ref-heading"
        >
          <h2
            id="doc-ref-heading"
            className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500"
          >
            Documentation
          </h2>
          <p className="mt-2 max-w-2xl font-sans text-xs leading-relaxed text-zinc-500">
            Step-by-step guide on{" "}
            <Link
              href="/docs"
              className={`text-zinc-300 underline-offset-2 transition-colors duration-200 ease-linear hover:text-white hover:underline ${focusLink} rounded-sm`}
            >
              /docs
            </Link>
            : install, log in, create a project, and call your API.
          </p>
          <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
            {(
              [
                { href: "/docs#install", k: "install", t: "Install the CLI (curl)" },
                { href: "/docs#authentication", k: "auth", t: "Log in with flux login" },
                { href: "/docs#create", k: "create", t: "Create your first database" },
              ] as const
            ).map((item) => (
              <li key={item.k}>
                <Link
                  href={item.href}
                  className={`group block border border-zinc-800 bg-zinc-950 px-3 py-2.5 transition-[border-color,background-color] duration-200 ease-linear hover:border-zinc-600 hover:bg-zinc-900/40 ${focusLink} rounded-sm`}
                >
                  <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-400 group-hover:text-zinc-200">
                    #{item.k}
                  </p>
                  <p className="mt-1 font-mono text-[9px] leading-relaxed text-zinc-600 group-hover:text-zinc-500">
                    {item.t}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
              Quick start
            </p>
            <CodeBlock
              size="comfortable"
              label="bash"
              code={`# Set FLUX_API_BASE + FLUX_API_TOKEN (see /docs#authentication)
flux login
flux create "my-app"
flux push ./schema.sql`}
            />
          </div>
        </section>

        <section
          id="install"
          aria-labelledby="install-heading"
          className="mt-20 border-t border-zinc-800 pt-16"
        >
          <h2
            id="install-heading"
            className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500"
          >
            Install the CLI
          </h2>
          <p className="mt-3 max-w-2xl font-sans text-sm leading-relaxed text-zinc-400">
            You need <strong className="font-medium text-zinc-300">Node.js 20+</strong> and{" "}
            <code className="text-zinc-400">curl</code> on your machine. The installer writes{" "}
            <code className="text-zinc-400">flux</code> to <code className="text-zinc-400">~/.local/bin</code> by
            default (no <code className="text-zinc-400">sudo</code>); add that directory to your{" "}
            <code className="text-zinc-400">PATH</code> if needed.
          </p>
          <p className="mt-3 max-w-2xl font-sans text-sm leading-relaxed text-zinc-500">
            Create a key in{" "}
            <Link
              href="/settings/keys"
              className={`text-zinc-300 underline-offset-2 transition-colors duration-200 ease-linear hover:text-white hover:underline ${focusLink} rounded-sm`}
            >
              Settings → API keys
            </Link>{" "}
            before the commands below.
          </p>
          <div className="mt-6" role="region" aria-label="Install Flux CLI">
            <CodeBlock
              size="comfortable"
              label="bash"
              code={`# One-liner (optional: FLUX_ORIGIN, or bash -s for install directory)
curl -sL https://flux.vsl-base.com/install | bash
# FLUX_ORIGIN=https://your-host curl -sL $FLUX_ORIGIN/install | bash
# curl -sL https://flux.vsl-base.com/install | bash -s /usr/local/bin

export FLUX_API_BASE="https://flux.vsl-base.com/api"
export FLUX_API_TOKEN="flx_live_…"

flux create "My project"
flux list`}
            />
          </div>
          <p className="mt-4 max-w-2xl font-sans text-xs text-zinc-500">
            If the download returns{" "}
            <span className="text-zinc-400">503</span>, the server build does not include the prebuilt
            CLI bundle (host must run <code className="text-zinc-500">pnpm --filter @flux/cli run build</code>{" "}
            before the dashboard image is built).
          </p>
          <p className="mt-4 font-sans text-sm text-zinc-400">
            <Link
              href="/docs#install"
              className={`text-zinc-300 underline-offset-2 transition-colors duration-200 ease-linear hover:text-white hover:underline ${focusLink} rounded-sm`}
            >
              Full docs on /docs
            </Link>
            {" — "}includes auth, create, and how to use your API URL.
          </p>
        </section>

        <p
          className="mt-auto border-t border-zinc-800/60 pt-16 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500/50 sm:pt-20"
          aria-label="Platform credits"
        >
          Built on Debian · Docker · Flux
        </p>
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

  const primaryClass = `inline-flex w-full items-center justify-center rounded-md bg-white px-6 py-3.5 text-base font-semibold text-zinc-950 transition-colors duration-200 ease-linear hover:bg-zinc-100 sm:w-auto ${focusPrimary}`;

  const secondaryClass = `inline-flex w-full items-center justify-center rounded-md border border-zinc-600 bg-zinc-950/50 px-6 py-3.5 text-base font-medium text-zinc-200 transition-[border-color,background-color] duration-200 ease-linear hover:border-zinc-500 hover:bg-zinc-900/80 sm:w-auto ${focusSecondary}`;

  if (status === "unauthenticated") {
    return (
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-4">
        <button
          type="button"
          onClick={() => void signIn("github", { callbackUrl: "/projects" })}
          className={primaryClass}
        >
          Get Started
        </button>
        <Link
          href="/#install"
          className={secondaryClass}
        >
          CLI install
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-4">
      <Link href="/projects" className={primaryClass}>
        Open Projects
      </Link>
      <Link href="/#install" className={secondaryClass}>
        CLI install
      </Link>
    </div>
  );
}

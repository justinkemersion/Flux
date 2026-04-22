"use client";

import { FleetManifest } from "@/src/components/landing/fleet-manifest";
import type { FleetShowcaseCard } from "@/src/lib/fleet-showcase";
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
};

export function FluxLanding({ fleetShowcase }: Props) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-950 text-zinc-100">
      <div className="flux-hero-grid border-b border-zinc-800/80">
        <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:px-10 sm:py-20 md:py-24">
          <div className="max-w-3xl">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-zinc-400">
              Platform
            </p>
            <h1
              id="flux-hero-heading"
              className="mt-3 font-sans text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-5xl md:text-6xl"
            >
              Deterministic Orchestration
            </h1>
            <p className="mt-6 max-w-2xl font-sans text-lg leading-relaxed text-zinc-400 sm:text-xl">
              Isolated PostgreSQL and PostgREST per project. One engine, one
              contract, zero noisy neighbors.
            </p>
            <div className="mt-10">
              <LandingCtas />
            </div>
          </div>
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col bg-zinc-950 px-6 py-16 text-zinc-100 sm:px-10 sm:py-20">
        <FleetManifest showcase={fleetShowcase} />

        <section
          id="install"
          aria-labelledby="install-heading"
          className="mt-20 border-t border-zinc-800 pt-16"
        >
          <h2
            id="install-heading"
            className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500"
          >
            CLI install
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
          <div
            className="mt-6 overflow-x-auto border border-zinc-800 bg-black/50 p-4 font-mono text-sm leading-relaxed text-zinc-300"
            role="region"
            aria-label="Install Flux CLI"
          >
            <pre className="whitespace-pre text-[12px] sm:text-[13px]">
{`# One-liner (optional: FLUX_ORIGIN, or bash -s for install directory)
curl -sL https://flux.vsl-base.com/install | bash
# FLUX_ORIGIN=https://your-host curl -sL $FLUX_ORIGIN/install | bash
# curl -sL https://flux.vsl-base.com/install | bash -s /usr/local/bin

export FLUX_API_BASE="https://flux.vsl-base.com/api"
export FLUX_API_TOKEN="flx_live_…"

flux create "My project"
flux list`}
            </pre>
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
              Full install &amp; API reference
            </Link>
            {" · "}
            same contract as the machine-readable Codex.
          </p>
        </section>

        <p
          className="mt-auto border-t border-zinc-800/60 pt-16 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500/50 sm:pt-20"
          aria-label="Platform credits"
        >
          ENGINEERED_ON_DEBIAN // POWERED_BY_DOCKER // ORCHESTRATED_BY_FLUX
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

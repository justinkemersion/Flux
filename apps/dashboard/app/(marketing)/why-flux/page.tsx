import type { Metadata } from "next";
import Link from "next/link";
import { PlatformComparison } from "../components/platform-comparison";

export const metadata: Metadata = {
  title: "Why Flux — A familiar shape, owned directly",
  description:
    "How Flux compares to general-purpose Postgres platforms: an owner-operated app foundry for durable small software.",
};

export default function WhyFluxPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-16 sm:px-8 sm:py-24">
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">
        Why Flux
      </p>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-zinc-400">
        For visitors already asking why not a polished general-purpose Postgres platform. Flux is
        an owner-operated app foundry — not a feature-parity alternative.
      </p>
      <div className="mt-16">
        <PlatformComparison />
      </div>
      <p className="mt-16">
        <Link
          href="/"
          className="text-sm font-medium text-zinc-400 underline-offset-4 transition-colors hover:text-zinc-200 hover:underline"
        >
          ← Back to the app showcase
        </Link>
      </p>
    </main>
  );
}

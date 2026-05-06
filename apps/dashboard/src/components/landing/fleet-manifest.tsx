"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FleetShowcaseCard } from "@/src/lib/fleet-showcase";
import {
  type FleetTelemetryLevel,
  fleetTelemetryLabel,
} from "@/src/lib/fleet-telemetry-display";
import { readResponseJson } from "@/src/lib/fetch-json";

const focus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

const dot: Record<FleetTelemetryLevel, string> = {
  operational: "bg-emerald-500",
  initializing: "bg-zinc-500",
  standby: "bg-zinc-600",
  offline: "bg-red-500",
};

const label: Record<FleetTelemetryLevel, string> = {
  operational: "text-emerald-400/95",
  initializing: "text-zinc-500/95",
  standby: "text-zinc-500/80",
  offline: "text-red-400/95",
};

type Props = {
  initialShowcase: FleetShowcaseCard[];
};

type TelemetryResponse = {
  items: Array<{ slug: string; level: FleetTelemetryLevel }>;
};

/**
 * Live mesh readout: initial data from RSC, then polls `/api/fleet/telemetry` so status dots
 * track `health_status` + heartbeat age without a full page reload.
 */
export function FleetManifest({ initialShowcase }: Props) {
  const [showcase, setShowcase] = useState(initialShowcase);

  useEffect(() => {
    setShowcase(initialShowcase);
  }, [initialShowcase]);

  useEffect(() => {
    let cancelled = false;
    async function syncFromMesh(): Promise<void> {
      try {
        const res = await fetch("/api/fleet/telemetry", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await readResponseJson(res, {
          apiLabel: "fleet telemetry API",
        })) as TelemetryResponse;
        if (!data.items?.length) return;
        setShowcase((prev) =>
          prev.map((card) => {
            const hit = data.items.find((i) => i.slug === card.slug);
            if (!hit) return card;
            return { ...card, level: hit.level };
          }),
        );
      } catch {
        /* offline or CORS */
      }
    }
    void syncFromMesh();
    const id = window.setInterval(
      () => {
        void syncFromMesh();
      },
      90_000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <section
      aria-labelledby="fleet-heading"
      className="w-full"
    >
      <h2
        id="fleet-heading"
        className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500"
      >
        Live mesh
      </h2>
      <p className="mt-2 max-w-2xl font-sans text-xs leading-relaxed text-zinc-500">
        Dedicated tenant stacks on the public mesh today—Postgres + PostgREST per project, one
        contract, deterministic operations. Flux is also moving toward pooled, schema-isolated
        tiers so the same CLI can target efficient shared infrastructure or dedicated engines.
        Status from PostgREST probes and catalog{" "}
        <code className="font-mono text-[10px] text-zinc-400">health_status</code> (2m).
      </p>
      <ul className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
        {showcase.map((p) => (
          <li key={p.name}>
            <article
              className="flex h-full flex-col border border-zinc-800 bg-zinc-950/80 p-5 transition-[border-color,background-color] duration-200 ease-linear md:p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="font-sans text-lg font-semibold tracking-tight text-zinc-100">
                  {p.name}
                </h3>
                <div
                  className={`flex max-w-[min(100%,11rem)] flex-col items-end gap-0.5 text-right font-mono text-[10px] uppercase leading-tight tracking-[0.1em] ${label[p.level]}`}
                  title="Mesh: catalog + Docker (5m window for green)"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot[p.level]}`}
                      aria-hidden
                    />
                    {fleetTelemetryLabel(p.level)}
                  </span>
                </div>
              </div>
              <p className="mt-1 font-mono text-xs text-zinc-400">
                <a
                  href={p.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`text-zinc-300 underline-offset-2 transition-colors duration-200 ease-linear hover:text-white hover:underline ${focus} rounded-sm`}
                >
                  {p.host}
                </a>
              </p>
              <p className="mt-3 font-sans text-sm leading-relaxed text-zinc-300">
                {p.description}
              </p>
              <dl className="mt-4 space-y-1 font-mono text-[10px] leading-relaxed text-zinc-500">
                <div>
                  <dt className="inline text-zinc-600">Region: </dt>
                  <dd className="inline text-zinc-400">Hetzner NBG1</dd>
                </div>
              </dl>
            </article>
          </li>
        ))}
        <li>
          <Link
            href="/docs/getting-started/installation"
            className={`group flex h-full min-h-[12rem] flex-col justify-between border border-dashed border-zinc-800 bg-zinc-950/20 p-5 transition-[border-color,background-color] duration-200 ease-linear hover:border-zinc-600 hover:bg-zinc-900/30 md:p-6 ${focus} rounded-none`}
          >
            <div>
              <p className="font-sans text-lg font-semibold tracking-tight text-zinc-200 transition-colors duration-200 ease-linear group-hover:text-white">
                Ready to provision?
              </p>
              <p className="mt-2 font-sans text-sm leading-relaxed text-zinc-400">
                Install the CLI, authenticate, and create a project—shared or dedicated execution
                is selected by tier and mode, not by a different product surface.
              </p>
            </div>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500 transition-colors duration-200 ease-linear group-hover:text-zinc-300">
              View CLI install instructions →
            </p>
          </Link>
        </li>
      </ul>
    </section>
  );
}

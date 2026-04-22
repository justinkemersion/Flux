import Link from "next/link";
import type { FleetShowcaseCard } from "@/src/lib/fleet-showcase";
import {
  type FleetTelemetryLevel,
  fleetTelemetryLabel,
} from "@/src/lib/fleet-telemetry-display";

const focus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

const dot: Record<FleetTelemetryLevel, string> = {
  operational: "bg-emerald-500",
  stale: "bg-amber-500",
  offline: "bg-red-500",
};

const label: Record<FleetTelemetryLevel, string> = {
  operational: "text-emerald-400/95",
  stale: "text-amber-400/95",
  offline: "text-red-400/95",
};

type Props = {
  showcase: FleetShowcaseCard[];
};

export function FleetManifest({ showcase }: Props) {
  return (
    <section
      aria-labelledby="fleet-heading"
      className="w-full"
    >
      <h2
        id="fleet-heading"
        className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500"
      >
        Flux infrastructure
      </h2>
      <p className="mt-2 max-w-2xl font-sans text-xs leading-relaxed text-zinc-500">
        Live tenant stacks on the public mesh: isolated engines, one contract, deterministic
        operations. Mesh status from PostgREST probes (2m).
      </p>
      <ul className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
        {showcase.map((p) => (
          <li key={p.name}>
            <article
              className="flex h-full flex-col border border-zinc-800 bg-zinc-950/30 p-5 transition-[border-color,background-color] duration-200 ease-linear md:p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="font-sans text-lg font-semibold tracking-tight text-zinc-100">
                  {p.name}
                </h3>
                <div
                  className={`flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] ${label[p.level]}`}
                  title="Mesh probe: running + fresh heartbeat = Operational"
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot[p.level]}`}
                    aria-hidden
                  />
                  <span>Status: {fleetTelemetryLabel(p.level)}</span>
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
              <dl className="mt-4 space-y-1 font-mono text-[10px] leading-relaxed text-zinc-400">
                <div>
                  <dt className="inline text-zinc-500">Region: </dt>
                  <dd className="inline">Hetzner NBG1</dd>
                </div>
              </dl>
            </article>
          </li>
        ))}
        <li>
          <Link
            href="/docs#install"
            className={`group flex h-full min-h-[12rem] flex-col justify-between border border-dashed border-zinc-800 bg-transparent p-5 transition-[border-color,background-color] duration-200 ease-linear hover:border-zinc-600 hover:bg-zinc-900/20 md:p-6 ${focus} rounded-none`}
          >
            <div>
              <p className="font-sans text-lg font-semibold tracking-tight text-zinc-200 transition-colors duration-200 ease-linear group-hover:text-white">
                Ready to Provision?
              </p>
              <p className="mt-2 font-sans text-sm leading-relaxed text-zinc-400">
                Install the CLI, authenticate, and create an isolated stack in
                one pass.
              </p>
            </div>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400 transition-colors duration-200 ease-linear group-hover:text-zinc-300">
              View CLI install instructions →
            </p>
          </Link>
        </li>
      </ul>
    </section>
  );
}

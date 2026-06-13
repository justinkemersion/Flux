import Link from "next/link";
import type { ShowcaseApp } from "../data/showcase-apps";
import {
  focusPrimary,
  focusSecondary,
  metricLineClass,
  spotlightCardClass,
  stackChipClass,
  statusPillClass,
} from "./landing-ui";

const primaryCtaClass = `inline-flex min-h-[44px] items-center justify-center rounded-md bg-white px-5 py-2.5 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-100 ${focusPrimary}`;

const demoCtaClass = `inline-flex min-h-[44px] items-center justify-center rounded-md border border-zinc-700/70 bg-transparent px-4 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200 ${focusSecondary}`;

function SpotlightCta({ app }: { app: ShowcaseApp }) {
  if (app.href === "#") return null;

  const primaryEl =
    app.external === false ? (
      <Link href={app.href} className={primaryCtaClass}>
        Open app →
      </Link>
    ) : (
      <a href={app.href} target="_blank" rel="noopener noreferrer" className={primaryCtaClass}>
        Open app →
      </a>
    );

  const demoEl = app.demoHref ? (
    <a
      href={app.demoHref}
      target="_blank"
      rel="noopener noreferrer"
      className={demoCtaClass}
    >
      Try demo
    </a>
  ) : null;

  return (
    <div className="flex flex-wrap gap-3">
      {primaryEl}
      {demoEl}
    </div>
  );
}

function SpotlightCard({ app }: { app: ShowcaseApp }) {
  return (
    <article className={spotlightCardClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-xl font-semibold tracking-tight text-zinc-100">{app.name}</h3>
        <span className={statusPillClass(app.status)}>{app.status}</span>
      </div>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
        {app.category}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-zinc-300">
        {app.tagline ?? app.description}
      </p>
      <div className="mt-auto pt-5">
        {app.metric && (
          <p className={`mb-4 ${metricLineClass}`}>{app.metric}</p>
        )}
        {app.stack.length > 0 && (
          <ul className="mb-4 flex flex-wrap gap-1.5" aria-label="Technology stack">
            {app.stack.map((chip) => (
              <li key={chip}>
                <span className={stackChipClass}>{chip}</span>
              </li>
            ))}
          </ul>
        )}
        <SpotlightCta app={app} />
      </div>
    </article>
  );
}

export function ShowcaseSpotlight({ apps }: { apps: ShowcaseApp[] }) {
  if (apps.length === 0) return null;

  return (
    <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">
      {apps.map((app) => (
        <SpotlightCard key={app.id} app={app} />
      ))}
    </div>
  );
}

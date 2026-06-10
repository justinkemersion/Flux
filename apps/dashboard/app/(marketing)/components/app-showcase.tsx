import Link from "next/link";
import { SHOWCASE_APPS, type ShowcaseApp } from "../data/showcase-apps";
import {
  cardClass,
  focusSecondary,
  sectionLabelClass,
  sectionTitleClass,
  statusPillClass,
} from "./landing-ui";

const ctaClass = `inline-flex min-h-[44px] items-center rounded-sm text-sm font-medium text-zinc-300 underline-offset-4 transition-colors hover:text-white hover:underline ${focusSecondary}`;

function CardCta({ app }: { app: ShowcaseApp }) {
  if (app.href === "#") {
    return (
      <span className="inline-flex min-h-[44px] items-center text-sm text-zinc-600">
        Coming soon
      </span>
    );
  }
  if (app.external === false) {
    return (
      <Link href={app.href} className={ctaClass}>
        Open Projects →
      </Link>
    );
  }
  return (
    <a href={app.href} target="_blank" rel="noopener noreferrer" className={ctaClass}>
      Open app →
    </a>
  );
}

export function AppShowcase() {
  return (
    <section id="apps" aria-labelledby="apps-heading" className="scroll-mt-24 text-left">
      <p className={sectionLabelClass}>Built with Flux</p>
      <h2 id="apps-heading" className={sectionTitleClass}>
        Built on the same foundation.
      </h2>
      <ul className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
        {SHOWCASE_APPS.map((app) => (
          <li key={app.name}>
            <article className={cardClass}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="text-lg font-semibold tracking-tight text-zinc-100">
                  {app.name}
                </h3>
                <span className={statusPillClass(app.status)}>{app.status}</span>
              </div>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                {app.category}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-zinc-300">{app.description}</p>
              <div className="mt-auto pt-4">
                {app.techLine ? (
                  <p className="font-mono text-[10px] tracking-[0.08em] text-zinc-500">
                    {app.techLine}
                  </p>
                ) : null}
                <div className="mt-1">
                  <CardCta app={app} />
                </div>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

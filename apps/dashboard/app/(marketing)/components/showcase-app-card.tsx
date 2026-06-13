import Link from "next/link";
import type { ShowcaseApp } from "../data/showcase-apps";
import {
  cardClass,
  focusSecondary,
  stackChipClass,
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

export function ShowcaseAppCard({ app }: { app: ShowcaseApp }) {
  return (
    <article className={cardClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-lg font-semibold tracking-tight text-zinc-100">{app.name}</h3>
        <span className={statusPillClass(app.status)}>{app.status}</span>
      </div>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
        {app.category}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-zinc-300">{app.description}</p>
      <div className="mt-auto pt-4">
        {app.stack.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Technology stack">
            {app.stack.map((chip) => (
              <li key={chip}>
                <span className={stackChipClass}>{chip}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2">
          <CardCta app={app} />
        </div>
      </div>
    </article>
  );
}

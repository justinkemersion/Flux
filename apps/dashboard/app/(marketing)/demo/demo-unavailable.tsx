import Link from "next/link";
import { SHOWCASE_DEMO_APPS } from "../data/landing-links";
import { secondaryCtaClass, sectionLabelClass, sectionTitleClass } from "../components/landing-ui";

export function DemoUnavailable() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-16 sm:px-8 sm:py-24">
      <section className="text-left">
        <p className={sectionLabelClass}>Demo</p>
        <h1 className={sectionTitleClass}>Flux demo is not configured on this host.</h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-zinc-400">
          You can still explore demo-ready apps built on Flux — real interfaces with seeded data
          and no private secrets.
        </p>
        <ul className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
          {SHOWCASE_DEMO_APPS.map((app) => (
            <li key={app.href}>
              <a
                href={app.href}
                target="_blank"
                rel="noopener noreferrer"
                className={secondaryCtaClass}
              >
                {app.name} →
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-8">
          <Link href="/#apps" className="text-sm text-zinc-400 underline-offset-4 hover:text-zinc-200 hover:underline">
            ← Back to the app showcase
          </Link>
        </p>
      </section>
    </main>
  );
}

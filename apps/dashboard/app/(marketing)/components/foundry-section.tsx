import Link from "next/link";
import { sectionLabelClass, sectionTitleClass } from "./landing-ui";

export function FoundrySection() {
  return (
    <section id="foundry" aria-labelledby="foundry-heading" className="scroll-mt-24 text-left">
      <p className={sectionLabelClass}>Philosophy</p>
      <h2 id="foundry-heading" className={sectionTitleClass}>
        Built for durable software.
      </h2>
      <div className="mt-4 max-w-2xl space-y-4 text-sm leading-relaxed text-zinc-400">
        <p>A foundry for small durable apps.</p>
        <p>
          Flux is the shared foundation underneath the apps above: Postgres, migrations, backups,
          JWT-aware APIs, demo mode, and deployment standards.
        </p>
        <p>
          It is not trying to replace your database tools. It gives each app a reliable operating
          base.
        </p>
      </div>
      <p className="mt-6">
        <Link
          href="/why-flux"
          className="text-sm font-medium text-zinc-300 underline-offset-4 transition-colors hover:text-white hover:underline"
        >
          Why Flux? →
        </Link>
      </p>
    </section>
  );
}

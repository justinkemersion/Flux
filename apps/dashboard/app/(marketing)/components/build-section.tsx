import Link from "next/link";
import { GetStartedButton } from "./get-started-button";
import { secondaryCtaClass, sectionLabelClass, sectionTitleClass } from "./landing-ui";

const lines = [
  "$ curl -sL https://flux.vsl-base.com/install | bash",
  "$ flux create my-app",
] as const;

export function BuildSection() {
  return (
    <section id="build" aria-labelledby="build-heading" className="scroll-mt-24 text-left">
      <p className={sectionLabelClass}>Build the next one</p>
      <h2 id="build-heading" className={sectionTitleClass}>
        Start from the same foundation used by the apps above.
      </h2>
      <pre
        className="mt-8 max-w-lg rounded-md border border-zinc-800/80 bg-zinc-900/50 px-4 py-3 text-left text-sm leading-relaxed text-zinc-300"
        style={{ fontFamily: "var(--font-landing-mono), ui-monospace, monospace" }}
      >
        <code>
          {lines.map((line) => (
            <span key={line} className="block whitespace-pre-wrap">
              {line}
            </span>
          ))}
        </code>
      </pre>
      <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
        <GetStartedButton />
        <Link href="/docs/introduction/what-is-flux" className={secondaryCtaClass}>
          View Architecture
        </Link>
      </div>
    </section>
  );
}

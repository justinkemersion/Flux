import { sectionLabelClass, sectionTitleClass } from "./landing-ui";

const notes = [
  "Seeded data only",
  "No secret viewing",
  "Clear path to sign in with your own account",
] as const;

export function DemoPhilosophy() {
  return (
    <section id="demo" aria-labelledby="demo-heading" className="scroll-mt-24 text-left">
      <p className={sectionLabelClass}>Demo philosophy</p>
      <h2 id="demo-heading" className={sectionTitleClass}>
        Real interfaces. Safe demos.
      </h2>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-zinc-400">
        Flux apps can expose a curated demo account with fake data, constrained actions, and no
        private secrets. The point is to let people understand the product by using it.
      </p>
      <ul className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
        {notes.map((note) => (
          <li
            key={note}
            className="inline-flex items-center rounded-md border border-zinc-800 px-3 py-2 text-xs text-zinc-400"
          >
            {note}
          </li>
        ))}
      </ul>
    </section>
  );
}

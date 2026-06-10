import { cardClass, sectionLabelClass, sectionTitleClass } from "./landing-ui";

const features = [
  {
    title: "Postgres by default",
    body: "Schema-first apps with migrations and durable storage.",
  },
  {
    title: "JWT-aware APIs",
    body: "Apps can expose clean APIs without rebuilding the same foundation.",
  },
  {
    title: "Demo mode",
    body: "Public visitors can explore curated fake data safely.",
  },
  {
    title: "Owned directly",
    body: "Built to be hosted, backed up, and maintained without platform theater.",
  },
  {
    title: "Dedicated or shared",
    body: "Start small, move to dedicated infrastructure when the app grows.",
  },
] as const;

export function InfrastructureSection() {
  return (
    <section
      id="platform"
      aria-labelledby="platform-heading"
      className="scroll-mt-24 text-left"
    >
      <p className={sectionLabelClass}>The foundation</p>
      <h2 id="platform-heading" className={sectionTitleClass}>
        What every Flux app gets
      </h2>
      <ul className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
        {features.map((f) => (
          <li key={f.title}>
            <article className={cardClass}>
              <h3 className="text-base font-semibold tracking-tight text-zinc-100">
                {f.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{f.body}</p>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

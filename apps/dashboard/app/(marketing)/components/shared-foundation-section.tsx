import { cardClass, sectionLabelClass, sectionTitleClass } from "./landing-ui";

const features = [
  {
    title: "Postgres by default",
    body: "Every app starts with durable relational storage.",
  },
  {
    title: "Migrations that travel",
    body: "Plain SQL workflows for creating and evolving app schemas.",
  },
  {
    title: "Restore-verified backups",
    body: "Backups are treated as useful only after they can be restored.",
  },
  {
    title: "JWT-aware APIs",
    body: "PostgREST-style APIs without hand-written CRUD servers.",
  },
  {
    title: "Demo-safe accounts",
    body: "Expose real interfaces with seeded data and locked-down permissions.",
  },
  {
    title: "Dedicated or shared",
    body: "Start pooled, move dedicated when the app needs its own house.",
  },
] as const;

export function SharedFoundationSection() {
  return (
    <section
      id="foundation"
      aria-labelledby="foundation-heading"
      className="scroll-mt-24 text-left"
    >
      <p className={sectionLabelClass}>The foundation</p>
      <h2 id="foundation-heading" className={sectionTitleClass}>
        One foundation. Many small apps.
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

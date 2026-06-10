import { sectionLabelClass, sectionTitleClass } from "./landing-ui";

const rows: ReadonlyArray<readonly [string, string]> = [
  ["General-purpose backend platform", "App foundry for Vessel/Flux apps"],
  ["Hosted product with many managed services", "Owner-operated infrastructure"],
  ["Broad feature surface", "Smaller, opinionated standards"],
  ["Project-centric", "Portfolio/ecosystem-centric"],
  ["Docs and dashboard-first", "Working app demos first"],
  ["Built for many teams and startups", "Built for durable small apps"],
];

export function PlatformComparison() {
  return (
    <section
      id="orientation"
      aria-labelledby="orientation-heading"
      className="scroll-mt-24 text-left"
    >
      <p className={sectionLabelClass}>Orientation</p>
      <h2 id="orientation-heading" className={sectionTitleClass}>
        A familiar shape, owned directly.
      </h2>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-zinc-400">
        Flux uses a familiar modern backend shape: Postgres, migrations, JWT-aware APIs, auth,
        deployment standards, and per-app environments. If Supabase is the polished
        general-purpose Postgres platform, Flux is the smaller owner-operated version built to
        launch and maintain a house of specific apps.
      </p>
      <div className="mt-8 rounded-md border border-zinc-800">
        <div className="hidden grid-cols-2 gap-4 border-b border-zinc-800/80 px-5 py-3 sm:grid">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
            Supabase-style platform
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400">
            Flux
          </p>
        </div>
        <ul>
          {rows.map(([left, right], i) => (
            <li
              key={left}
              className={`grid grid-cols-1 gap-1 px-5 py-3.5 sm:grid-cols-2 sm:gap-4 ${
                i > 0 ? "border-t border-zinc-800/60" : ""
              }`}
            >
              <p className="text-sm leading-relaxed text-zinc-500">
                <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600 sm:hidden">
                  Supabase-style
                </span>
                {left}
              </p>
              <p className="text-sm leading-relaxed text-zinc-300">
                <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600 sm:hidden">
                  Flux
                </span>
                {right}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

import { getFeaturedApps, getGridApps, getShowcaseStats } from "../data/showcase-apps";
import { sectionLabelClass } from "./landing-ui";
import { FadeIn } from "./fade-in";
import { ShowcaseFilterGrid } from "./showcase-filter";
import { ShowcaseSpotlight } from "./showcase-spotlight";
import { ShowcaseStats } from "./showcase-stats";

function consoleSummary(total: number): string {
  return `${total} apps · one foundation · live and demo-ready`;
}

export function AppShowcase() {
  const { total } = getShowcaseStats();
  const featured = getFeaturedApps();
  const grid = getGridApps();

  return (
    <section id="apps" aria-labelledby="apps-heading" className="scroll-mt-24 text-left">
      {/* Console header */}
      <FadeIn>
        <p className={sectionLabelClass}>Showcase Console</p>
        <h2
          id="apps-heading"
          className="mt-3 text-2xl font-medium tracking-tight text-white sm:text-3xl"
        >
          Live products on one foundation.
        </h2>
        <p className="mt-2 font-mono text-[11px] tracking-[0.08em] text-zinc-600">
          {consoleSummary(total)}
        </p>
      </FadeIn>

      {/* Status counts */}
      <FadeIn delay={0.08}>
        <ShowcaseStats />
      </FadeIn>

      {/* Spotlight — featured apps */}
      {featured.length > 0 && (
        <FadeIn delay={0.15} className="mt-10">
          <p className={`mb-1 ${sectionLabelClass}`}>Featured</p>
          <ShowcaseSpotlight apps={featured} />
        </FadeIn>
      )}

      {/* Filterable app grid — remaining apps */}
      {grid.length > 0 && (
        <FadeIn delay={0.22} className="mt-10">
          <p className={`mb-4 ${sectionLabelClass}`}>All apps</p>
          <ShowcaseFilterGrid apps={grid} />
        </FadeIn>
      )}
    </section>
  );
}

export type ShowcaseStatus = "Active" | "Demo Ready" | "Alpha" | "Concept";
export type ShowcaseEngine = "v2_shared" | "v1_dedicated";

export type ShowcaseApp = {
  /** Stable kebab-case slug used as React key and for filtering. */
  id: string;
  name: string;
  /** Short headline shown in spotlight; falls back to `description`. */
  tagline?: string;
  description: string;
  status: ShowcaseStatus;
  category: string;
  /** Renderable stack chips, e.g. ["Auth", "Postgres", "Demo Mode"]. */
  stack: string[];
  /** `#` means no public URL yet — card renders a "Coming soon" CTA instead of a link. */
  href: string;
  /** Optional separate demo-mode link (e.g. a guest/seeded login). */
  demoHref?: string;
  /** False for internal routes (Flux → /projects). Defaults to true. */
  external?: boolean;
  /** Promotes the app into the spotlight section. */
  featured?: boolean;
  /** One quiet proof line shown in spotlight, e.g. "Seeded demo · no secrets". */
  metric?: string;
  engine?: ShowcaseEngine;
};

export type ShowcaseStats = {
  total: number;
  byStatus: Partial<Record<ShowcaseStatus, number>>;
};

export const SHOWCASE_APPS: ShowcaseApp[] = [
  {
    id: "vessel-ledger",
    name: "Vessel Ledger",
    tagline: "A calm ledger for obligations and recurring records.",
    description: "A calm ledger for obligations, records, and recurring operations.",
    status: "Demo Ready",
    category: "Personal finance / records",
    stack: ["Auth", "Postgres", "Demo Mode"],
    href: "https://ledger.vsl-base.com/",
    featured: true,
    metric: "Seeded demo · no secrets",
    engine: "v2_shared",
  },
  {
    id: "habitat",
    name: "Habitat",
    tagline: "Persistent atmosphere context for conscious home-building.",
    description: "Persistent atmosphere context for conscious home-building.",
    status: "Demo Ready",
    category: "Home / objects",
    stack: ["Auth", "Postgres", "Demo Mode"],
    href: "https://habitat.vsl-base.com/",
    featured: true,
    metric: "Seeded demo · no secrets",
    engine: "v2_shared",
  },
  {
    id: "mailpilot-ai",
    name: "MailPilot AI",
    tagline: "Inbox maintenance for real life.",
    description: "Inbox maintenance for real life.",
    status: "Alpha",
    category: "Mail / AI",
    stack: ["Auth", "Postgres", "AI"],
    href: "https://mailpilot.vsl-base.com/",
    engine: "v2_shared",
  },
  {
    id: "bloom-atelier",
    name: "Bloom Atelier",
    tagline: "An editorial marketplace for independent makers.",
    description: "An editorial marketplace for independent makers.",
    status: "Active",
    category: "Commerce / catalog",
    stack: ["Auth", "Postgres"],
    href: "https://bloom.vsl-base.com/",
    engine: "v2_shared",
  },
  {
    id: "yeastcoast",
    name: "YeastCoast",
    tagline: "A brewing project for repeatable, classic-quality beer.",
    description: "A brewing project for repeatable, classic-quality beer.",
    status: "Active",
    category: "Brewing / recipes",
    stack: ["Auth", "Postgres", "Dedicated"],
    href: "https://yeastcoast.vsl-base.com",
    engine: "v1_dedicated",
  },
  {
    id: "logos-engine",
    name: "Logos Engine",
    tagline: "Read the Greek world from the source.",
    description: "Read the Greek world from the source.",
    status: "Alpha",
    category: "Language / texts",
    stack: ["Postgres"],
    href: "https://logos.vsl-base.com/",
    engine: "v2_shared",
  },
  {
    id: "roommating",
    name: "Roommating",
    tagline: "Shared-space coordination, made calm.",
    description: "Shared-space coordination, made calm.",
    status: "Concept",
    category: "Home / coordination",
    stack: ["Auth", "Postgres"],
    href: "#",
    engine: "v2_shared",
  },
  {
    id: "la-casa-dashboard",
    name: "La Casa Dashboard",
    tagline: "A home operations dashboard for the long-term resident.",
    description: "A home operations dashboard for the long-term resident.",
    status: "Concept",
    category: "Home / operations",
    stack: ["Auth", "Postgres"],
    href: "#",
    engine: "v2_shared",
  },
  {
    id: "flux",
    name: "Flux",
    tagline: "Infrastructure for small, serious web projects.",
    description: "Infrastructure for small, serious web projects.",
    status: "Active",
    category: "Platform",
    stack: ["Auth", "Postgres", "PostgREST"],
    href: "/projects",
    external: false,
    engine: "v2_shared",
  },
];

export function getShowcaseStats(): ShowcaseStats {
  const byStatus: Partial<Record<ShowcaseStatus, number>> = {};
  for (const app of SHOWCASE_APPS) {
    byStatus[app.status] = (byStatus[app.status] ?? 0) + 1;
  }
  return { total: SHOWCASE_APPS.length, byStatus };
}

export function getFeaturedApps(): ShowcaseApp[] {
  return SHOWCASE_APPS.filter((a) => a.featured);
}

export function getGridApps(): ShowcaseApp[] {
  return SHOWCASE_APPS.filter((a) => !a.featured);
}

export type ShowcaseStatus = "Active" | "Demo Ready" | "Alpha" | "Concept";

export type ShowcaseApp = {
  name: string;
  description: string;
  status: ShowcaseStatus;
  category: string;
  /** `#` means no public URL yet — card renders a "Coming soon" CTA instead of a link. */
  href: string;
  /** Subtle technical metadata line, e.g. "Auth · Postgres · Demo Mode". */
  techLine?: string;
  /** False for internal routes (Flux → /projects). Defaults to true. */
  external?: boolean;
};

export const SHOWCASE_APPS: ShowcaseApp[] = [
  {
    name: "Vessel Ledger",
    description: "A calm ledger for obligations, records, and recurring operations.",
    status: "Demo Ready",
    category: "Personal finance / records",
    href: "https://ledger.vsl-base.com/",
    techLine: "Auth · Postgres · Demo Mode",
  },
  {
    name: "Habitat Ledger",
    description: "Persistent atmosphere context for conscious home-building.",
    status: "Demo Ready",
    category: "Home / objects",
    href: "https://habitat.vsl-base.com/",
    techLine: "Auth · Postgres · Demo Mode",
  },
  {
    name: "MailPilot AI",
    description: "Inbox maintenance for real life.",
    status: "Alpha",
    category: "Mail / AI",
    href: "https://mailpilot.vsl-base.com/",
    techLine: "Auth · Postgres",
  },
  {
    name: "Bloom Atelier",
    description: "An editorial marketplace for independent makers.",
    status: "Active",
    category: "Commerce / catalog",
    href: "https://bloom.vsl-base.com/",
    techLine: "Auth · Postgres",
  },
  {
    name: "YeastCoast",
    description: "A brewing project for repeatable, classic-quality beer.",
    status: "Active",
    category: "Brewing / recipes",
    href: "https://yeastcoast.vsl-base.com",
    techLine: "Auth · Postgres · Dedicated",
  },
  {
    name: "Logos Engine",
    description: "Read the Greek world from the source.",
    status: "Alpha",
    category: "Language / texts",
    href: "https://logos.vsl-base.com/",
    techLine: "Postgres",
  },
  {
    name: "Flux",
    description: "Infrastructure for small, serious web projects.",
    status: "Active",
    category: "Platform",
    href: "/projects",
    techLine: "Auth · Postgres · PostgREST",
    external: false,
  },
];

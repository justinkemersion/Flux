/** Static nav for Flux docs — mirrors docs/_contract/information-architecture tree. */

export type DocsNavItem = {
  title: string;
  /** Path segments under docs/pages (no .md), e.g. ["introduction", "what-is-flux"] */
  slug: string[];
};

export type DocsNavSection = {
  label: string;
  items: DocsNavItem[];
};

export const DOCS_NAV: DocsNavSection[] = [
  {
    label: "Introduction",
    items: [
      { title: "What is Flux?", slug: ["introduction", "what-is-flux"] },
      { title: "Why Flux?", slug: ["introduction", "why-flux"] },
      { title: "Mental model", slug: ["introduction", "mental-model"] },
    ],
  },
  {
    label: "Getting started",
    items: [
      { title: "Installation", slug: ["getting-started", "installation"] },
      { title: "Create a project", slug: ["getting-started", "create-project"] },
      { title: "First request", slug: ["getting-started", "first-request"] },
      { title: "Authentication", slug: ["getting-started", "auth"] },
    ],
  },
  {
    label: "Concepts",
    items: [
      { title: "Projects", slug: ["concepts", "projects"] },
      { title: "Migrations", slug: ["concepts", "migrations"] },
      { title: "JWT authentication", slug: ["concepts", "jwt-auth"] },
      { title: "Row-level security", slug: ["concepts", "rls"] },
      { title: "Pooled vs dedicated", slug: ["concepts", "pooled-vs-dedicated"] },
      { title: "Service URLs", slug: ["concepts", "service-urls"] },
    ],
  },
  {
    label: "Architecture",
    items: [
      { title: "Flux v2 shared", slug: ["architecture", "flux-v2"] },
      {
        title: "Flux v2 architecture",
        slug: ["architecture", "flux-v2-architecture"],
      },
      { title: "Gateway", slug: ["architecture", "gateway"] },
      { title: "Bridge JWTs", slug: ["architecture", "bridge-jwts"] },
      { title: "Tenant isolation", slug: ["architecture", "tenant-isolation"] },
      { title: "Request flow", slug: ["architecture", "request-flow"] },
    ],
  },
  {
    label: "Security",
    items: [
      { title: "Authentication model", slug: ["security", "authentication-model"] },
      { title: "Tenant isolation", slug: ["security", "tenant-isolation"] },
      { title: "RLS boundaries", slug: ["security", "rls-boundaries"] },
      { title: "Project secrets", slug: ["security", "project-secrets"] },
      { title: "Threat model", slug: ["security", "threat-model"] },
    ],
  },
  {
    label: "Guides",
    items: [
      { title: "Auth.js", slug: ["guides", "authjs"] },
      { title: "Next.js", slug: ["guides", "nextjs"] },
      { title: "Clerk", slug: ["guides", "clerk"] },
      { title: "Migrations", slug: ["guides", "migrations"] },
      {
        title: "V1 dedicated quick SQL",
        slug: ["guides", "v1-dedicated-sql-workflows"],
      },
      {
        title: "Pooled → dedicated migrate",
        slug: ["guides", "v2-to-v1-migrate"],
      },
      { title: "Production hardening", slug: ["guides", "production-hardening"] },
    ],
  },
  {
    label: "Examples",
    items: [
      { title: "Bloom Atelier", slug: ["examples", "bloom-atelier"] },
      { title: "Simple CRUD", slug: ["examples", "simple-crud"] },
      { title: "Multi-tenant app", slug: ["examples", "multi-tenant-app"] },
    ],
  },
  {
    label: "Reference",
    items: [
      { title: "CLI", slug: ["reference", "cli"] },
      { title: "Environment variables", slug: ["reference", "env-vars"] },
      { title: "Configuration", slug: ["reference", "config"] },
    ],
  },
];

export function docsHref(slug: string[]): string {
  if (slug.length === 0) return "/docs";
  return `/docs/${slug.join("/")}`;
}

/** Flattened reading order for prev/next links. */
export function getDocsFlatNav(): DocsNavItem[] {
  return DOCS_NAV.flatMap((s) => s.items);
}

export function getAdjacentDocs(slug: string[]): {
  prev: DocsNavItem | null;
  next: DocsNavItem | null;
} {
  const flat = getDocsFlatNav();
  if (slug.length === 0) {
    // Root /docs already orients readers; skip straight to Why Flux (not What is Flux again).
    const whyFlux = flat.find(
      (item) => item.slug.join("/") === "introduction/why-flux",
    );
    return { prev: null, next: whyFlux ?? flat[0] ?? null };
  }
  const key = slug.join("/");
  const idx = flat.findIndex((item) => item.slug.join("/") === key);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? flat[idx - 1]! : null,
    next: idx < flat.length - 1 ? flat[idx + 1]! : null,
  };
}
